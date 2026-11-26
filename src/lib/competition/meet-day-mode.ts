/**
 * Meet-Day Mode (pure, tested in competition-handling.test.ts): what matters
 * right now, read from the timeline, the gameplan and what's been logged on the
 * day. One answer for each question a handler asks under pressure: what stage
 * is it, what's next and when, which lift is on, which attempts are coming,
 * which warm-up is next (weight and reps), the rack heights, and what changed.
 */
import type { Timeline, TimelineEntry } from "./event-timeline";
import { rackText, type GameplanDoc } from "./gameplan";
import type { Lift } from "./types";

export type MeetStage = "before" | "weigh_in" | Lift | "done";
export const STAGE_WORD: Record<MeetStage, string> = {
  before: "Before weigh-in",
  weigh_in: "Weigh-in",
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
  done: "Finished",
};

export type LoggedAttempt = { lift: Lift; attempt: number; kg: number | null; result: "good" | "no_lift" | "pending" };

export type MeetDayView = {
  stage: MeetStage;
  current: TimelineEntry | null;
  next: TimelineEntry | null;
  /** minutes until the next entry starts (negative: running late) */
  nextInMinutes: number | null;
  lift: Lift | null;
  attempts: Array<{ attempt: number; kg: number | null; result: "good" | "no_lift" | "pending" | "planned" }>;
  nextWarmup: { kg: number; reps: number; at: number | null; index: number; of: number } | null;
  rack: string | null;
  /** schedule changes the day's progression made, newest first */
  changes: string[];
};

function liftOf(e: TimelineEntry | null | undefined): Lift | null {
  return e?.lift ?? (e?.group === "squat" || e?.group === "bench" || e?.group === "deadlift" ? e.group : null);
}

export function meetDayView(input: {
  timeline: Timeline;
  plan: GameplanDoc | null;
  now: { date: string; minutes: number };
  logged?: LoggedAttempt[];
}): MeetDayView {
  const { now } = input;
  const timed = input.timeline.entries.filter((e) => e.at != null);
  const key = (e: TimelineEntry) => `${e.date}|${String(e.at).padStart(5, "0")}`;
  const nowKey = `${now.date}|${String(now.minutes).padStart(5, "0")}`;
  const past = timed.filter((e) => key(e) <= nowKey);
  const future = timed.filter((e) => key(e) > nowKey);
  const logged = input.logged ?? [];

  // the lift: the one with attempts still to do once its flight has started, by what's logged first
  let lift: Lift | null = null;
  for (const l of ["squat", "bench", "deadlift"] as Lift[]) {
    const done = logged.filter((x) => x.lift === l && x.result !== "pending").length;
    const started = past.some((e) => liftOf(e) === l && (e.kind === "flight" || e.kind === "warmup" || e.kind === "warmup_set" || e.kind === "attempt"));
    if (done > 0 && done < 3) {
      lift = l;
      break;
    }
    if (started && done < 3) {
      lift = l;
      break;
    }
  }
  const allDone = (["squat", "bench", "deadlift"] as Lift[]).every(
    (l) => logged.filter((x) => x.lift === l && x.result !== "pending").length >= 3,
  );
  const lastPast = past[past.length - 1] ?? null;
  let stage: MeetStage;
  if (allDone || lastPast?.kind === "finish" || lastPast?.kind === "awards") stage = "done";
  else if (lift) stage = lift;
  else if (past.some((e) => e.kind === "weigh_in") || (future[0]?.kind === "weigh_in" && (future[0].at! - now.minutes) <= 30 && future[0].date === now.date)) stage = "weigh_in";
  else stage = "before";

  const next = future.find((e) => e.kind !== "warmup_set" || liftOf(e) === lift) ?? null;
  const nextInMinutes = next && next.date === now.date && next.at != null ? next.at - now.minutes : null;

  const plan = input.plan;
  const attempts = lift
    ? [1, 2, 3].map((n) => {
        const got = logged.find((x) => x.lift === lift && x.attempt === n);
        const planned = plan?.attempts[lift]?.[n === 1 ? "opener" : n === 2 ? "second" : "third"] ?? null;
        return {
          attempt: n,
          kg: got?.kg ?? planned,
          result: (got ? got.result : "planned") as "good" | "no_lift" | "pending" | "planned",
        };
      })
    : [];

  let nextWarmup: MeetDayView["nextWarmup"] = null;
  const wuLift = lift ?? (stage === "before" || stage === "weigh_in" ? "squat" : null);
  if (wuLift && !logged.some((x) => x.lift === wuLift)) {
    const sets = timed.filter((e) => e.kind === "warmup_set" && liftOf(e) === wuLift);
    const idx = sets.findIndex((e) => key(e) >= nowKey);
    const rows = plan?.warmups[wuLift]?.rows ?? [];
    const i = idx >= 0 ? idx : sets.length ? -1 : 0;
    if (i >= 0 && rows[i]) nextWarmup = { kg: rows[i].kg, reps: rows[i].reps, at: sets[i]?.at ?? null, index: i + 1, of: rows.length };
  }
  const rackLift = lift ?? wuLift;
  const rack = rackLift && rackLift !== "deadlift" ? rackText(plan?.equipment.racks[rackLift]) || null : null;
  const sh = input.timeline.shift;
  const changes =
    sh != null && Math.abs(sh) >= 5
      ? [`Running about ${Math.abs(sh)} minutes ${sh > 0 ? "behind" : "ahead of"} the estimate; later times moved`]
      : [];
  const conflicts = input.timeline.entries
    .filter((e) => e.conflict)
    .map((e) => `${e.label}: the estimate now differs from the confirmed time`);
  return {
    stage,
    current: lastPast,
    next,
    nextInMinutes,
    lift,
    attempts,
    nextWarmup,
    rack,
    changes: [...conflicts, ...changes],
  };
}
