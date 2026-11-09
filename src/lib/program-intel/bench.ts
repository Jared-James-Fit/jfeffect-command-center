import type { IntelRecords } from "./types";

/**
 * A benchmark run can test a deadline the athlete doesn't have: a pretend meet (`benchMeet`) or a
 * dated long-term goal (`benchGoal`) added to this run's own copy of the records only, so the
 * context, the brief and the horizon all read it the same way. Nothing is written. Never on a
 * coach's run.
 */
export function benchRecords(rec: IntelRecords, job: any): IntelRecords {
  if (!job?.options?.bench) return rec;
  const meet = job.options.benchMeet as { name?: string; date?: string } | undefined;
  const goal = job.options.benchGoal as { text?: string; date?: string } | undefined;
  const iso = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  let out = rec;
  if (meet && iso(meet.date))
    out = { ...out, preps: [{ id: "bench-meet", title: meet.name ?? "Meet", goal_type: "competition", event_name: meet.name ?? "Meet", event_date: meet.date, federation: null, weight_class: null, division: null, status: "Active", coach_notes: null } as any, ...out.preps.filter((p) => !p.event_date || p.event_date !== meet.date)] };
  if (goal && iso(goal.date) && goal.text) out = { ...out, profile: { ...(out.profile ?? ({} as any)), long_term_goal: { text: goal.text, date: goal.date, savedAt: new Date().toISOString() } } as any };
  return out;
}
