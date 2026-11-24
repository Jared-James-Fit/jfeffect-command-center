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

export async function runOpenIpfNotify(admin: Db): Promise<{ suggestions: number; pushed: number }> {
  const { data: rows, error } = await admin
    .from("openipf_suggestions")
    .select("*, scan:openipf_scans(finished_at)")
    .eq("status", "pending")
    .is("notified_at", null)
    .limit(200);
  if (error) throw new Error(error.message);
  // a search still running tells once it's done, with everything it found
  const ready = ((rows ?? []) as any[]).filter((r) => r.kind === "new_meet" || !r.scan_id || r.scan?.finished_at) as OpenIpfSuggestion[];
  if (!ready.length) return { suggestions: 0, pushed: 0 };

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
  const batch = ready.map((s) => s.id).sort().join(",").slice(0, 400);
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
        eventKey: `openipf:${hash(batch)}:${userId}`,
        rateKey: `openipf:${userId}`,
        rateWindowMinutes: 30,
        priority: "normal",
      },
    );
    pushed += r.sent;
  }
  await admin.from("openipf_suggestions").update({ notified_at: new Date().toISOString() }).in("id", ready.map((s) => s.id));
  return { suggestions: ready.length, pushed };
}

/** A short stable key for one batch (the push's dedupe key). */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
