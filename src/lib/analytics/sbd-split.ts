/**
 * SBD total split: where a lifter's total comes from, which lift carries it,
 * which one has the most room, and a few low-cost focuses for that lift.
 * Pure functions; all loads in lb.
 */

export type SbdLift = "squat" | "bench" | "deadlift";
export const SBD_LIFTS: SbdLift[] = ["squat", "bench", "deadlift"];
export type NormSex = "male" | "female";

export const LIFT_LABEL: Record<SbdLift, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
};

/**
 * Typical raw share of total, as fractions. Centered on the averages across
 * JF Effect athletes' meet results (men 35.7 / 23.7 / 40.6 %, women 35.2 /
 * 20.8 / 44.0 %, 73 meets), which line up with public raw-meet averages.
 * Leverages and weight class move these, so they guide, they don't judge.
 */
export const TYPICAL_SHARE: Record<NormSex | "any", Record<SbdLift, [number, number]>> = {
  male: { squat: [0.34, 0.38], bench: [0.22, 0.26], deadlift: [0.385, 0.425] },
  female: { squat: [0.335, 0.375], bench: [0.19, 0.23], deadlift: [0.415, 0.455] },
  // Sex unknown: wide enough to hold both, so only clear outliers get flagged.
  any: { squat: [0.335, 0.38], bench: [0.19, 0.26], deadlift: [0.385, 0.455] },
};

export type MaxSource = "logged" | "coach" | "meet";
export type SbdMax = {
  lift: SbdLift;
  lb: number;
  source: MaxSource;
  date: string | null;
  /** The logged set behind a "logged" max. */
  set?: { load: number; reps: number };
};

/** Map a lift/max name to a competition lift; variations return null. */
export function compLiftFromName(name: string | null | undefined): SbdLift | null {
  const n = (name ?? "").trim().toLowerCase();
  if (/^(competition\s+)?(back\s+)?squat$/.test(n)) return "squat";
  if (/^(competition\s+)?bench(\s+press)?$/.test(n)) return "bench";
  if (/^(competition\s+)?((conventional|sumo)\s+)?deadlift$/.test(n)) return "deadlift";
  return null;
}

function epley(load: number, reps: number) {
  if (!(load > 0) || !(reps >= 1)) return 0;
  return reps === 1 ? load : load * (1 + reps / 30);
}

/**
 * Best estimated 1RM per competition lift from logged sets. Sets over
 * `maxReps` are skipped: Epley drifts past ~10 reps.
 */
export function bestLoggedMaxes(
  sets: { lift: SbdLift; load: number; reps: number; date: string }[],
  maxReps = 10,
): Partial<Record<SbdLift, SbdMax>> {
  const out: Partial<Record<SbdLift, SbdMax>> = {};
  for (const s of sets) {
    if (s.reps > maxReps) continue;
    const e = Math.round(epley(s.load, s.reps) * 10) / 10;
    if (!(e > 0)) continue;
    const cur = out[s.lift];
    if (!cur || e > cur.lb || (e === cur.lb && (cur.date ?? "") > s.date)) {
      out[s.lift] = {
        lift: s.lift,
        lb: e,
        source: "logged",
        date: s.date,
        set: { load: s.load, reps: s.reps },
      };
    }
  }
  return out;
}

/**
 * Current max per lift: the higher of the best logged e1RM and the coach's
 * max (a tested 1RM usually beats an e1RM from submax volume work). A meet
 * result fills in only when neither exists.
 */
export function pickCurrentMaxes(
  logged: Partial<Record<SbdLift, SbdMax>>,
  coach: Partial<Record<SbdLift, SbdMax>>,
  meet: Partial<Record<SbdLift, SbdMax>>,
): Partial<Record<SbdLift, SbdMax>> {
  const out: Partial<Record<SbdLift, SbdMax>> = {};
  for (const lift of SBD_LIFTS) {
    const l = logged[lift];
    const c = coach[lift];
    out[lift] = l && c ? (c.lb > l.lb ? c : l) : (l ?? c ?? meet[lift]);
    if (!out[lift]) delete out[lift];
  }
  return out;
}

export type SplitLift = {
  lift: SbdLift;
  lb: number;
  share: number;
  range: [number, number];
  status: "above" | "within" | "below";
  /** Share relative to the typical midpoint: +0.05 = 5 % above typical. */
  rel: number;
};

export type SbdSplit = {
  total: number;
  lifts: SplitLift[];
  /** The lift carrying the total relative to a typical split. */
  strongest: SbdLift;
  /** The lift with the most room relative to a typical split. */
  focus: SbdLift;
  /**
   * Pounds of total gained by bringing `focus` up to a typical share (the
   * range midpoint), others unchanged. Null unless `focus` is below range.
   */
  gainToTypical: number | null;
};

export function sbdSplit(maxes: Record<SbdLift, number>, sex: NormSex | null): SbdSplit {
  const norms = TYPICAL_SHARE[sex ?? "any"];
  const total = maxes.squat + maxes.bench + maxes.deadlift;
  const lifts = SBD_LIFTS.map((lift): SplitLift => {
    const share = maxes[lift] / total;
    const range = norms[lift];
    const mid = (range[0] + range[1]) / 2;
    return {
      lift,
      lb: maxes[lift],
      share,
      range,
      status: share > range[1] ? "above" : share < range[0] ? "below" : "within",
      rel: share / mid - 1,
    };
  });
  const byRel = [...lifts].sort((a, b) => b.rel - a.rel);
  const focus = byRel[byRel.length - 1];
  let gainToTypical: number | null = null;
  if (focus.status === "below") {
    // Raise only the focus lift until its share reaches the typical midpoint:
    // x / (others + x) = mid  →  x = mid × others / (1 − mid).
    const others = total - focus.lb;
    const mid = (focus.range[0] + focus.range[1]) / 2;
    gainToTypical = (mid * others) / (1 - mid) - focus.lb;
  }
  return { total, lifts, strongest: byRel[0].lift, focus: focus.lift, gainToTypical };
}

/**
 * Low-cost focuses for a lift. `free` fit inside sessions already on the plan
 * (no extra sets, no extra fatigue); `askCoach` changes volume or exercise
 * choice, so it goes through the coach instead of being bolted on.
 */
export const LIFT_FOCUS: Record<SbdLift, { free: string[]; askCoach: string }> = {
  squat: {
    free: [
      "Rehearse on every warm-up: same walkout, same breath and brace, same depth from the empty bar up.",
      "Pause your last warm-up 2 seconds in the hole. Owning the bottom costs nothing and carries straight to the comp lift.",
      "Film your top set from 45° to the side. Depth and bar over midfoot are where most squat pounds hide.",
    ],
    askCoach:
      "If you lose it out of the hole, a paused squat is the usual fix. Ask your coach whether one fits this block before adding it.",
  },
  bench: {
    free: [
      "Pause every rep on your chest, warm-ups included. A touch-and-go bench isn't your comp lift.",
      "Same setup every set: blades pinned, feet planted, grip on the same ring mark. Small setup changes cost real pounds.",
      "Press every submax rep as fast as you can with clean form. Max intent builds speed off the chest at no fatigue cost.",
    ],
    askCoach:
      "Bench usually responds best to frequency. Ask your coach if a short extra bench exposure, like a few light paused sets, fits your week.",
  },
  deadlift: {
    free: [
      "Reset every rep from a dead stop. No touch-and-go: that's how the comp pull starts.",
      "Pull the slack out of the bar before it leaves the floor, warm-ups included. A loose start bleeds speed.",
      "Hold the last warm-up rep at lockout for 5 seconds. Free grip work so your hands never cap your pull.",
    ],
    askCoach:
      "Know where it slows down. Slow off the floor usually points to deficit or paused pulls; slow at the knees or lockout to block pulls. Ask your coach which fits.",
  },
};

/** Distinct training days per week for a lift over the trailing `weeks`. */
export function sessionsPerWeek(
  sets: { lift: SbdLift; date: string }[],
  lift: SbdLift,
  now: Date,
  weeks = 4,
): number {
  const since = now.getTime() - weeks * 7 * 86_400_000;
  const days = new Set<string>();
  for (const s of sets) {
    if (s.lift !== lift) continue;
    const t = new Date(s.date);
    if (t.getTime() < since || t.getTime() > now.getTime()) continue;
    days.add(`${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`);
  }
  return days.size / weeks;
}
