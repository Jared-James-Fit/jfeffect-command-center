import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { actionTexts } from "./packages";
import { bookingWords, buildCallPrep, type CallPrep, type PrepInput, type PrepReview } from "./call-prep";

/**
 * The coach's side of a call with a client: the overview before it
 * (getCallPrep) and the action items after it (saveCallReview), all read and
 * written with the coach's own login (RLS: an admin, or the client's own
 * coach). The coach's private note stays the session sheet's own note
 * (session-coach-notes.ts); action items reach the client only when the coach
 * sends them in the chat (markCallReviewShared records that).
 */

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type CallPrepResult = CallPrep & {
  sessionId: string;
  clientId: string;
  clientName: string | null;
  firstName: string | null;
  when: string | null;
  sessionDate: string;
  /** This call's own action items and priorities (after the call). */
  review: { actionItems: string[]; nextPriorities: string | null; sharedAt: string | null } | null;
};

export const getCallPrep = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<CallPrepResult> => {
    const { supabase } = context as any;
    const { data: s, error } = await supabase
      .from("pt_sessions")
      .select("id, client_id, session_date, starts_at, notes, booking_card_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("You can't see this call.");
    const clientId: string = s.client_id;
    const { data: c } = await supabase
      .from("clients")
      .select("full_name, first_name, preferred_name, timezone")
      .eq("id", clientId)
      .maybeSingle();
    const tz = (c as any)?.timezone || "America/Winnipeg";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const from = addDays(today, -28);

    const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };

    const [wm, dated, pain, topics, reviews, plan, usage] = await Promise.all([
      safe(async () => {
        const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
        return loadWeightManagement(supabase, clientId, { today });
      }),
      safe(async () => {
        const { loadDatedWorkouts } = await import("@/lib/cleo-schedule.server");
        return loadDatedWorkouts(supabase, { clientIds: [clientId], from, to: today });
      }),
      safe(async () => {
        const { loadPainEntries } = await import("@/lib/pain/load");
        const { buildPainHistory } = await import("@/lib/pain/history");
        const entries = (await loadPainEntries(supabase, [clientId])).get(clientId) ?? [];
        return buildPainHistory(entries, today);
      }),
      safe(async () => {
        const { data: t } = await supabase.from("coaching_call_topics").select("topics").eq("pt_session_id", s.id).maybeSingle();
        return ((t as any)?.topics as string | undefined) ?? null;
      }),
      safe(async () => {
        const { data: rows } = await supabase
          .from("coaching_call_reviews")
          .select("pt_session_id, action_items, next_priorities, shared_at, pt_sessions!inner(session_date)")
          .eq("client_id", clientId)
          .order("updated_at", { ascending: false })
          .limit(20);
        return (rows ?? []) as any[];
      }),
      safe(async () => {
        const { data: t } = await supabase
          .from("nutrition_targets")
          .select("phase, custom_phase, start_date, status, nutrition_target_days(calories)")
          .eq("client_id", clientId)
          .neq("status", "Archived")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return t as any;
      }),
      safe(async () => {
        if (!s.booking_card_id) return null;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: u } = await (supabaseAdmin as any).rpc("coaching_call_usage", {
          _client: clientId,
          _card: s.booking_card_id,
          _on: s.session_date,
        });
        return u as any;
      }),
    ]);

    // Workouts, the app's way (cleo-schedule: entries first, else the day's own date)
    let workouts: PrepInput["workouts"] = null;
    if (dated) {
      const { isMissed } = await import("@/lib/cleo-schedule");
      const mine = (dated as any[]).filter((w) => w.clientId === clientId && w.visible);
      const planned = mine.filter((w) => !w.optional).length;
      const done = mine.filter((w) => w.done);
      const ratings = done.map((w) => w.rating).filter((r): r is number => typeof r === "number" && r > 0);
      workouts = {
        planned,
        done: done.length,
        missed: mine.filter((w) => isMissed(w, today)).length,
        lastDone: done.length ? done[done.length - 1]!.date : null,
        avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      };
    }

    const t = wm?.assessment.trajectory;
    const unit = (wm?.client.unit ?? "lb") as "kg" | "lb";
    const reviewRows = (reviews ?? []) as any[];
    const own = reviewRows.find((r) => r.pt_session_id === s.id) ?? null;
    const prev = reviewRows
      .filter((r) => r.pt_session_id !== s.id && String(r.pt_sessions?.session_date ?? "") < s.session_date)
      .sort((a, b) => String(b.pt_sessions?.session_date).localeCompare(String(a.pt_sessions?.session_date)))[0];
    const previous: PrepReview | null = prev
      ? {
          date: prev.pt_sessions.session_date,
          actionItems: actionTexts(prev.action_items),
          nextPriorities: prev.next_priorities ?? null,
          shared: !!prev.shared_at,
        }
      : null;
    const kcals = ((plan?.nutrition_target_days ?? []) as any[]).map((d) => Number(d.calories)).filter((n) => n > 0);
    const { REASON_WORDS } = await import("@/lib/pain/history");

    const prep = buildCallPrep({
      today,
      topics: topics ?? null,
      bookingNote: bookingWords(s.notes),
      workouts,
      bodyweight: t
        ? {
            unit,
            latestKg: t.latest?.kg ?? null,
            latestDate: t.latest?.date ?? null,
            avg7Kg: t.average7?.kg ?? null,
            weeklyChangeKg: t.weeklyChangeKg,
            goalKg: t.goal?.kg ?? null,
            goalDate: t.goal?.date ?? null,
            stale: t.stale,
          }
        : null,
      checkins: wm
        ? {
            count: wm.assessment.checkins.count,
            latest: wm.assessment.checkins.latest,
            adherence: wm.assessment.checkins.adherence,
            poorSleep: wm.assessment.checkins.poorSleep,
            lowEnergy: wm.assessment.checkins.lowEnergy,
            stress: wm.assessment.checkins.stress,
          }
        : null,
      nutrition: plan
        ? {
            phase: plan.custom_phase || plan.phase || null,
            kcalLow: kcals.length ? Math.min(...kcals) : null,
            kcalHigh: kcals.length ? Math.max(...kcals) : null,
            since: plan.start_date ?? null,
          }
        : null,
      pain: (pain?.flagged ?? pain?.areas ?? []).slice(0, 3).map((a: any) => ({
        label: a.label,
        status: a.status,
        trend: a.trend,
        reasons: (a.reasons ?? []).map((r: string) => (REASON_WORDS as Record<string, string>)[r] ?? r),
      })),
      weightRead: wm?.assessment.recommendation.headline ?? null,
      previous,
      calls: usage ? { used: Number(usage.used), included: Number(usage.included), periodEnd: String(usage.period_end) } : null,
    });

    const first = (c as any)?.preferred_name || (c as any)?.first_name || String((c as any)?.full_name ?? "").split(/\s+/)[0] || null;
    return {
      ...prep,
      sessionId: s.id,
      clientId,
      clientName: (c as any)?.full_name ?? null,
      firstName: first,
      when: s.starts_at ?? null,
      sessionDate: s.session_date,
      review: own
        ? { actionItems: actionTexts(own.action_items), nextPriorities: own.next_priorities ?? null, sharedAt: own.shared_at ?? null }
        : null,
    };
  });

/** The coach's action items and next priorities after a call (staff only; the client sees them only once sent). */
export const saveCallReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        actionItems: z.array(z.string().trim().max(300)).max(12),
        nextPriorities: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const items = data.actionItems.map((a) => a.trim()).filter(Boolean);
    const { data: saved, error } = await supabase
      .from("coaching_call_reviews")
      .upsert({ pt_session_id: data.sessionId, action_items: items, next_priorities: data.nextPriorities || null })
      .select("pt_session_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("You can't change this call's notes.");
    return { ok: true };
  });

/** After the coach sent the action items in the chat: which message, and when. */
export const markCallReviewShared = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: z.string().uuid(), messageId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: saved, error } = await supabase
      .from("coaching_call_reviews")
      .update({ shared_at: new Date().toISOString(), shared_by: userId, shared_message_id: data.messageId })
      .eq("pt_session_id", data.sessionId)
      .select("pt_session_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("Save the action items first.");
    return { ok: true };
  });
