/**
 * Attempt selection (pure, tested): for each lift an opener the athlete makes
 * on a bad day, second and third ranges, three pathways (conservative,
 * balanced, aggressive), what to do after each kind of attempt, and what to do
 * when one goes wrong. Every weight is a multiple of the federation's
 * increment and never lower than the attempt before it.
 *
 * Openers come from the athlete's own history when they have one (what they
 * open at as a share of what they make, 86–95%), else 91% (92% bench) of the
 * expected max, and never above 96% of the conservative scenario: an opener is
 * there to get a total, not to test anything. A lift they've missed openers on
 * opens a step lower. The official attempts are always the coach's call.
 */
import type { AttemptStats } from "./meet-stats";
import { ceilTo, floorTo, roundTo, type FederationRules } from "./rules";
import type { Lift, Objective, Range } from "./types";

export type Triple3 = [number, number, number];

export type LiftAttempts = {
  lift: Lift;
  opener: number;
  openerConservative: number;
  second: { low: number; high: number };
  third: { low: number; high: number };
  pathways: { conservative: Triple3; balanced: Triple3; aggressive: Triple3 };
  conditional: Array<{ when: string; then: string }>;
  contingencies: Array<{ when: string; then: string }>;
  why: string[];
};

const DEFAULT_OPENER: Record<Lift, number> = { squat: 0.91, bench: 0.92, deadlift: 0.91 };

/** Each attempt at least one increment over the last, every one on the increment. */
export function climb(a: number[], step: number): Triple3 {
  const out = [floorTo(a[0], step)];
  for (let i = 1; i < 3; i++) out.push(Math.max(roundTo(a[i], step), out[i - 1] + step));
  return out as Triple3;
}

export function planLiftAttempts(input: {
  lift: Lift;
  range: Range;
  rules: FederationRules;
  history?: AttemptStats | null;
  objective?: Objective | null;
  /** the heaviest single in training in the last 6 weeks (kg), when there is one */
  recentTopSingleKg?: number | null;
}): LiftAttempts {
  const { lift, range } = input;
  const step = input.rules.incrementKg;
  const why: string[] = [];
  const own =
    input.history?.meetsWithAttempts && input.history.meetsWithAttempts >= 2
      ? input.history.openerPct[lift]
      : null;
  let openerPct = own != null ? Math.min(0.95, Math.max(0.86, own)) : DEFAULT_OPENER[lift];
  if (own != null) why.push(`They usually open at ${Math.round(own * 100)}% of what they make`);
  else why.push(`Opener at ${Math.round(openerPct * 100)}% of the expected max`);
  // openers missed before: one step lower
  const missedOpeners =
    input.history && input.history.taken[0]
      ? input.history.taken[0] -
        Math.round((input.history.success[0] ?? 1) * input.history.taken[0])
      : 0;
  if (missedOpeners >= 2) {
    openerPct -= 0.02;
    why.push(`${missedOpeners} missed openers on record: opener a little lower`);
  }
  let opener = floorTo(range.expected * openerPct, step);
  const safeCap = floorTo(range.conservative * 0.96, step);
  if (opener > safeCap) {
    opener = safeCap;
    why.push("Kept under the conservative day's reach");
  }
  if (input.recentTopSingleKg && opener > input.recentTopSingleKg + step)
    why.push(
      `Opener is over their heaviest recent training single (${input.recentTopSingleKg} kg): check they've handled it`,
    );
  const openerConservative = Math.max(
    step,
    floorTo(opener - Math.max(step, range.expected * 0.02), step),
  );

  const conservative = climb([opener, range.expected * 0.955, range.expected * 0.98], step);
  const balanced = climb([opener, range.expected * 0.965, range.expected], step);
  const aggressive = climb(
    [opener, range.expected * 0.975, Math.min(range.high, range.expected * 1.025)],
    step,
  );
  if (
    input.objective === "first_meet" ||
    input.objective === "experience" ||
    input.objective === "return"
  )
    why.push("Objective is a clean meet: the conservative pathway is the plan");
  if (input.objective === "win" || input.objective === "podium")
    why.push("Placing decides the deadlift thirds on the day: the calculator works it out live");

  const second = { low: conservative[1], high: aggressive[1] };
  const third = { low: conservative[2], high: aggressive[2] };
  const { conditional, contingencies } = attemptRules({
    pathways: { conservative, balanced, aggressive },
    opener,
    openerConservative,
    noLower: input.rules.noLowerAfterAttempt,
  });
  return {
    lift,
    opener,
    openerConservative,
    second,
    third,
    pathways: { conservative, balanced, aggressive },
    conditional,
    contingencies,
    why,
  };
}

/** What to do after each kind of attempt and when one goes wrong, from the pathways' numbers. */
export function attemptRules(input: {
  pathways: { conservative: Triple3; balanced: Triple3; aggressive: Triple3 };
  opener: number;
  openerConservative: number;
  noLower: boolean;
}): {
  conditional: Array<{ when: string; then: string }>;
  contingencies: Array<{ when: string; then: string }>;
} {
  const { conservative, balanced, aggressive } = input.pathways;
  const { opener, openerConservative, noLower } = input;
  const conditional = [
    {
      when: "Opener moves easily (RPE 7 or under, or faster than the usual opener)",
      then: `Second at ${aggressive[1]} kg`,
    },
    { when: "Opener is a solid RPE 8", then: `Second at ${balanced[1]} kg` },
    {
      when: "Opener is RPE 9 or slow",
      then: `Second at ${conservative[1]} kg, third no more than ${conservative[2]} kg`,
    },
    {
      when: "Second is RPE 8 or under",
      then: `Third at ${balanced[2]}–${aggressive[2]} kg, the objective decides`,
    },
    { when: "Second is RPE 9", then: `Third at ${conservative[2]} kg, or protect the total` },
  ];
  const contingencies = [
    {
      when: "Missed opener on a command or depth",
      then: `Repeat ${opener} kg${noLower ? " (the bar can't go lower)" : ""}; fix the cue, not the weight`,
    },
    {
      when: "Missed opener on strength",
      then: noLower
        ? `Repeat ${opener} kg: two more misses is no total, so the pathway drops to conservative for the rest of the day`
        : `Take ${openerConservative} kg next`,
    },
    {
      when: "Missed second",
      then: `Repeat it or take the third at the same weight; no jump after a miss`,
    },
    {
      when: "Pain or something feels wrong",
      then: "Stop and decide with the coach before the next attempt: the total matters more than one lift",
    },
  ];
  return { conditional, contingencies };
}

export type AttemptPlan = {
  lifts: Record<Lift, LiftAttempts | null>;
  totals: Record<"conservative" | "balanced" | "aggressive", number | null>;
};

export function planAttempts(input: {
  lifts: Record<Lift, Range | null>;
  rules: FederationRules;
  history?: AttemptStats | null;
  objective?: Objective | null;
  recentTopSingles?: Partial<Record<Lift, number | null>>;
}): AttemptPlan {
  const lifts = {} as Record<Lift, LiftAttempts | null>;
  for (const lift of ["squat", "bench", "deadlift"] as Lift[]) {
    const r = input.lifts[lift];
    lifts[lift] = r
      ? planLiftAttempts({
          lift,
          range: r,
          rules: input.rules,
          history: input.history,
          objective: input.objective,
          recentTopSingleKg: input.recentTopSingles?.[lift] ?? null,
        })
      : null;
  }
  const sum = (k: "conservative" | "balanced" | "aggressive") => {
    const all = Object.values(lifts);
    return all.every(Boolean) ? all.reduce((s, l) => s + l!.pathways[k][2], 0) : null;
  };
  return {
    lifts,
    totals: {
      conservative: sum("conservative"),
      balanced: sum("balanced"),
      aggressive: sum("aggressive"),
    },
  };
}

/** The next attempt the rules allow after `last` (made or missed): never lower, on the increment. */
export function nextAllowed(
  last: number | null,
  rules: FederationRules,
  made: boolean,
): number | null {
  if (last == null) return null;
  return made
    ? last + rules.incrementKg
    : rules.noLowerAfterAttempt
      ? last
      : ceilTo(last - rules.incrementKg, rules.incrementKg);
}
