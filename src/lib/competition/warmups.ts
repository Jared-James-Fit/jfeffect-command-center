/**
 * Competition warm-ups (pure, tested): a ramp to the opener built from the
 * athlete's own warm-up habits where they have them (how many sets they take
 * to a heavy set, and how heavy their last warm-up runs against their first
 * working set, from pl_warmup_sets), else a standard ramp. Timed against the
 * platform in attempts, not minutes, because flights run late: the last
 * warm-up when about eight attempts are left before theirs.
 */
import { floorTo, toLb } from "./rules";
import type { Lift } from "./types";

export type WarmupHistory = {
  /** sessions of this lift with logged warm-ups */
  sessions: number;
  /** median warm-up sets before the first working set */
  medianSets: number | null;
  /** median last warm-up ÷ first working set */
  lastPct: number | null;
};

export type WarmupSet = {
  kg: number;
  lb: number;
  reps: number;
  pct: number;
  restMin: number;
  minutesBefore: number;
};

export type WarmupPlan = {
  lift: Lift;
  opener: number;
  sets: WarmupSet[];
  last: { kg: number; pct: number; expectedRpe: string };
  general: string[];
  equipment: string[];
  timing: string[];
  delays: string[];
  individual: boolean;
  why: string[];
};

const RAMP: Record<Lift, Array<[number, number]>> = {
  squat: [
    [0, 5],
    [0.4, 5],
    [0.55, 3],
    [0.67, 2],
    [0.77, 1],
    [0.85, 1],
    [0.92, 1],
  ],
  bench: [
    [0, 10],
    [0.4, 5],
    [0.55, 3],
    [0.67, 2],
    [0.77, 1],
    [0.85, 1],
    [0.92, 1],
  ],
  deadlift: [
    [0.4, 3],
    [0.55, 3],
    [0.67, 2],
    [0.77, 1],
    [0.85, 1],
    [0.92, 1],
  ],
};

const GENERAL: Record<Lift, string[]> = {
  squat: [
    "5–8 min of easy movement to get warm",
    "Hips, ankles and upper back: the mobility they do before heavy squats",
    "Bodyweight squats and a few hip hinges",
  ],
  bench: [
    "Light movement between lifts: the body is warm, the shoulders need it again",
    "Band pull-aparts and the upper-back set-up they use in training",
    "A few pause reps with the bar",
  ],
  deadlift: [
    "Easy movement to come back up after bench",
    "Hamstrings and hips: the drills they use before heavy pulls",
    "Light hinges before the bar",
  ],
};

const EQUIPMENT: Record<Lift, string[]> = {
  squat: ["Knee sleeves on from the first barbell set", "Belt from about 75%"],
  bench: ["Wrist wraps from about 70%", "Belt if they bench with one"],
  deadlift: [
    "Belt from about 75%",
    "Deadlift socks or shin guards",
    "Chalk from the first heavy pull",
  ],
};

export function planWarmups(input: {
  lift: Lift;
  openerKg: number;
  history?: WarmupHistory | null;
  barKg?: number;
  step?: number;
  /** Cleo's checked change: the last warm-up's weight, or the whole ladder (proposals.ts) */
  override?: { lastKg?: number | null; sets?: Array<{ kg: number; reps: number }> | null } | null;
}): WarmupPlan {
  const { lift } = input;
  const step = input.step ?? 2.5;
  const bar = input.barKg ?? 20;
  const why: string[] = [];
  let ramp = [...RAMP[lift]];
  const h = input.history;
  const individual = !!h && h.sessions >= 3;
  if (individual && h!.lastPct != null) {
    const p = Math.min(0.96, Math.max(0.85, h!.lastPct));
    ramp[ramp.length - 1] = [p, 1];
    why.push(
      `Last warm-up at ${Math.round(p * 100)}% of the opener: how heavy their last warm-up usually runs`,
    );
  }
  if (individual && h!.medianSets != null) {
    const target = Math.max(4, Math.min(8, Math.round(h!.medianSets) + (lift === "bench" ? 1 : 0)));
    while (ramp.length > target && ramp.length > 4) ramp.splice(Math.floor(ramp.length / 2), 1);
    if (ramp.length < target)
      why.push(
        "They usually take more warm-up sets; add a single between the last two if they want it",
      );
    else why.push(`${ramp.length} sets, about what they take in training`);
  }
  if (!individual) why.push("A standard ramp: not enough logged warm-ups to individualize yet");

  const raw = ramp.map(([p, reps]) => ({
    kg: p === 0 ? bar : Math.max(bar, floorTo(input.openerKg * p, step)),
    reps,
    pct: p,
  }));
  // strictly rising, no repeats
  let sets: Array<{ kg: number; reps: number; pct: number }> = [];
  for (const s of raw) if (!sets.length || s.kg > sets[sets.length - 1].kg) sets.push(s);
  const o = input.override;
  if (o?.sets?.length) {
    sets = o.sets.map((s) => ({ kg: s.kg, reps: s.reps, pct: s.kg / input.openerKg }));
    why.unshift("Cleo's warm-up ladder, checked against the opener");
  } else if (o?.lastKg) {
    const lastKg = o.lastKg;
    sets = sets.filter((s, i) => i < sets.length - 1 && s.kg < lastKg);
    sets.push({ kg: lastKg, reps: 1, pct: lastKg / input.openerKg });
    why.unshift(
      `Last warm-up at ${lastKg} kg (${Math.round((lastKg / input.openerKg) * 100)}% of the opener): Cleo's call from their history`,
    );
  }

  // timing: last warm-up ~8 minutes before the opener, heavier sets 4 min apart, lighter 3
  const timed: WarmupSet[] = [];
  let t = 8;
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i];
    const rest = i === sets.length - 1 ? 0 : s.pct >= 0.75 ? 4 : 3;
    t += rest;
    timed.unshift({
      kg: s.kg,
      lb: toLb(s.kg),
      reps: s.reps,
      pct: Math.round(s.pct * 100) / 100,
      restMin: i === sets.length - 1 ? 8 : rest,
      minutesBefore: i === sets.length - 1 ? 8 : t,
    });
  }
  const last = timed[timed.length - 1];
  return {
    lift,
    opener: input.openerKg,
    sets: timed,
    last: {
      kg: last.kg,
      pct: last.pct,
      expectedRpe: "around RPE 6–7: it should move like a confident training single",
    },
    general: GENERAL[lift],
    equipment: EQUIPMENT[lift],
    timing: [
      `Start the barbell sets about ${Math.max(20, timed[0].minutesBefore + 5)} minutes before the opener`,
      "Count attempts, not minutes: last warm-up when about 8 attempts are left before theirs",
    ],
    delays: [
      "Flight running late: hold at the second-last warm-up; repeat the last warm-up only if more than 15 minutes pass",
      "Flight running early: skip a middle set, never the last one",
    ],
    individual,
    why,
  };
}

/** Warm-up habits from logged warm-ups: per session, the sets before the first working set and the last one's share of it. */
export function warmupHistory(
  sessions: Array<{ warmups: number[]; firstWorkingKg: number | null }>,
): WarmupHistory {
  const usable = sessions.filter(
    (s) => s.warmups.length && s.firstWorkingKg && s.firstWorkingKg > 0,
  );
  const med = (xs: number[]) => {
    if (!xs.length) return null;
    const v = [...xs].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return {
    sessions: usable.length,
    medianSets: med(usable.map((s) => s.warmups.length)),
    lastPct: med(
      usable
        .map((s) => Math.max(...s.warmups) / s.firstWorkingKg!)
        .filter((p) => p > 0.5 && p < 1.05),
    ),
  };
}
