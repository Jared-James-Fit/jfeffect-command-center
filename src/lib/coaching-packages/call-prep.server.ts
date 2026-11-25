/**
 * The records a conversation with a client is prepared from, read once with
 * the caller's own login (RLS: an admin, or the client's own coach): their
 * workouts, bodyweight and check-ins (the weight-management read), pain, the
 * nutrition plan in force, and earlier calls' action items. Used by a booked
 * call's prep (getCallPrep) and by coaching sessions (coaching-sessions), so
 * both read a client the same way. Every part is best effort: one that can't
 * be read is null, never guessed.
 */
import { actionTexts } from "./packages";
import type { PrepInput, PrepReview } from "./call-prep";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type ClientPrepRecords = Omit<PrepInput, "today" | "topics" | "bookingNote" | "previous" | "calls"> & {
  /** earlier calls' action items, newest first, each with its pt_session id and date */
  reviews: Array<{
    ptSessionId: string;
    date: string;
    actionItems: string[];
    nextPriorities: string | null;
    shared: boolean;
    sharedAt: string | null;
  }>;
  unit: "kg" | "lb";
};

export async function loadClientPrepRecords(supabase: any, clientId: string, today: string): Promise<ClientPrepRecords> {
  const from = addDays(today, -28);
  const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const [wm, dated, pain, reviews, plan] = await Promise.all([
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
  ]);

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
  const unit = ((wm?.client.unit ?? "lb") as "kg" | "lb");
  const kcals = ((plan?.nutrition_target_days ?? []) as any[]).map((d) => Number(d.calories)).filter((n) => n > 0);
  const { REASON_WORDS } = await import("@/lib/pain/history");

  return {
    unit,
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
    pain: ((pain as any)?.flagged ?? (pain as any)?.areas ?? []).slice(0, 3).map((a: any) => ({
      label: a.label,
      status: a.status,
      trend: a.trend,
      reasons: (a.reasons ?? []).map((r: string) => (REASON_WORDS as Record<string, string>)[r] ?? r),
    })),
    weightRead: wm?.assessment.recommendation.headline ?? null,
    reviews: ((reviews ?? []) as any[])
      .filter((r) => r.pt_sessions?.session_date)
      .map((r) => ({
        ptSessionId: r.pt_session_id,
        date: String(r.pt_sessions.session_date),
        actionItems: actionTexts(r.action_items),
        nextPriorities: r.next_priorities ?? null,
        shared: !!r.shared_at,
        sharedAt: r.shared_at ?? null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** The last call before a date, for its follow-ups. */
export function previousReview(
  reviews: ClientPrepRecords["reviews"],
  before: string,
  exceptPtSession?: string | null,
): PrepReview | null {
  const r = reviews.find((x) => x.ptSessionId !== exceptPtSession && x.date < before);
  return r ? { date: r.date, actionItems: r.actionItems, nextPriorities: r.nextPriorities, shared: r.shared } : null;
}
