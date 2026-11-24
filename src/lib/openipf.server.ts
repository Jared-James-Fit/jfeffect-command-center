/**
 * OpenIPF's pushes: the tick (public.openipf_tick, every minute) wakes the
 * openipf-notify hook when a finished search found someone or the sync brought
 * in a new meet. One push per person per batch: the admin hears about
 * everything, a coach about their own clients. Content-light: names and the
 * meet, never anything else about the athlete.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { inboxPreview, prLine, suggestionOrder, type OpenIpfSuggestion } from "@/lib/openipf";

type Db = SupabaseClient<any, any, any>;

/** "2 new meets, 1 possible match" */
export function batchTitle(list: Pick<OpenIpfSuggestion, "kind">[]): string {
  const meets = list.filter((s) => s.kind === "new_meet").length;
  const matches = list.length - meets;
  const parts = [
    meets ? `${meets} new meet${meets === 1 ? "" : "s"}` : null,
    matches ? `${matches} possible match${matches === 1 ? "" : "es"}` : null,
  ].filter(Boolean);
  return `OpenIPF: ${parts.join(", ")}`;
}

/**
 * Whether a batch has been told: a push went, or waits for the end of quiet
 * hours, or the person has no device to send to. A push held back by the day's
 * cap (or the half-hour limit) isn't telling anyone, so the batch stays
 * waiting and the tick tries again (the cap resets at their midnight).
 */
export function batchTold(results: { sent: number; skipped: string | null }[]): boolean {
  if (!results.length) return true;
  return results.some((r) => r.sent > 0 || r.skipped === "queued_quiet_hours" || r.skipped === "no_subs" || r.skipped === "master_off" || (r.skipped ?? "").startsWith("category_off"))
    || results.every((r) => r.skipped === "not_configured");
}

export async function runOpenIpfNotify(admin: Db): Promise<{ suggestions: number; pushed: number; told: boolean }> {
  const { data: rows, error } = await admin
    .from("openipf_suggestions")
    .select("*, scan:openipf_scans(finished_at)")
    .eq("status", "pending")
    .is("notified_at", null)
    .limit(200);
  if (error) throw new Error(error.message);
  // a search still running tells once it's done, with everything it found
  const ready = ((rows ?? []) as any[]).filter((r) => r.kind === "new_meet" || !r.scan_id || r.scan?.finished_at) as OpenIpfSuggestion[];
  if (!ready.length) return { suggestions: 0, pushed: 0, told: true };

  const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = ((admins ?? []) as any[]).map((a) => a.user_id).filter(Boolean) as string[];
  const clientIds = [...new Set(ready.map((s) => s.client_id).filter(Boolean))] as string[];
  const coachOf = new Map<string, string>();
  if (clientIds.length) {
    const { data: clients } = await admin.from("clients").select("id, assigned_coach_id").in("id", clientIds);
    const coachIds = [...new Set(((clients ?? []) as any[]).map((c) => c.assigned_coach_id).filter(Boolean))];
    const { data: coaches } = coachIds.length
      ? await admin.from("coaches").select("id, user_id").in("id", coachIds).eq("status", "Active").eq("archived", false)
      : { data: [] as any[] };
    const userOfCoach = new Map(((coaches ?? []) as any[]).map((c) => [c.id, c.user_id]));
    for (const c of (clients ?? []) as any[]) {
      const u = userOfCoach.get(c.assigned_coach_id);
      if (u) coachOf.set(c.id, u);
    }
  }
  const byUser = new Map<string, OpenIpfSuggestion[]>();
  for (const s of ready) {
    const to = new Set(adminIds);
    const coach = s.client_id ? coachOf.get(s.client_id) : null;
    if (coach) to.add(coach);
    for (const u of to) byUser.set(u, [...(byUser.get(u) ?? []), s]);
  }

  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  const { safeDisplayName } = await import("@/lib/push/notification-payload");
  let pushed = 0;
  const results: { sent: number; skipped: string | null }[] = [];
  for (const [userId, list] of byUser) {
    const sorted = [...list].sort(suggestionOrder).map((s) => ({ ...s, subject_name: safeDisplayName(s.subject_name, "An athlete") }));
    const anyPr = sorted.some((s) => s.kind === "new_meet" && prLine(s.prs));
    const r = await sendWebPushToUser(
      admin,
      userId,
      {
        title: batchTitle(sorted),
        body: `${inboxPreview(sorted)}. Tap to review.`,
        url: "/admin/messages?openipf=1",
        tag: "openipf",
        data: { kind: "openipf", sourceId: sorted[0].id },
      },
      {
        category: anyPr ? "wins" : "workouts",
        // once per half hour at most; what's been told is the suggestions' notified_at
        rateKey: `openipf:${userId}`,
        rateWindowMinutes: 30,
        priority: "normal",
      },
    );
    pushed += r.sent;
    results.push(r);
  }
  const told = batchTold(results);
  if (told) await admin.from("openipf_suggestions").update({ notified_at: new Date().toISOString() }).in("id", ready.map((s) => s.id));
  return { suggestions: ready.length, pushed, told };
}
