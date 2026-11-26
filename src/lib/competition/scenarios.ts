/**
 * The meet-day calculator (pure, tested in competition-scenarios.test.ts): from
 * the attempts as they stand, what each lifter's total is, the standings, and
 * the exact deadlift our athlete needs for a placing, a qualifying total or a
 * record. Deterministic: Cleo may explain a scenario, never compute it.
 *
 * Totals: a lifter's best made attempt per lift; a lifter with a lift that has
 * no made attempt and none left has no total (bombed). Ties follow the rules
 * on file: under IPF rules the lighter lifter at weigh-in places higher, and
 * with the same bodyweight whoever made the total first; with bodyweights
 * unknown a tie is treated as not good enough (one increment more is asked
 * for), never assumed won.
 */
import { ceilTo, type FederationRules } from "./rules";
import type { Lift } from "./types";

export type AttemptResult = "good" | "no_lift" | "pending";
export type LiveAttempt = { kg: number | null; result: AttemptResult | null };
export type Entrant = {
  id: string;
  name: string;
  us?: boolean;
  bodyweight: number | null;
  attempts: Record<Lift, LiveAttempt[]>;
};

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

export function bestMade(a: LiveAttempt[]): number | null {
  const made = a.filter((x) => x.result === "good" && x.kg != null).map((x) => x.kg!);
  return made.length ? Math.max(...made) : null;
}

/** Attempts still to come on a lift (declared or not), out of three. */
export function remaining(a: LiveAttempt[]): number {
  const done = a.filter((x) => x.result === "good" || x.result === "no_lift").length;
  return Math.max(0, 3 - done);
}

export type Standing = {
  id: string;
  name: string;
  us: boolean;
  subtotal: number;
  /** current total (null while a lift has no made attempt) */
  total: number | null;
  bombed: boolean;
  bodyweight: number | null;
  /** the most they can reach if every attempt still to come is made at its declared weight (or not counted when undeclared) */
  ceiling: number | null;
  place: number | null;
};

export function standings(entrants: Entrant[]): Standing[] {
  const rows = entrants.map((e) => {
    let subtotal = 0;
    let complete = true;
    let bombed = false;
    let ceiling = 0;
    let ceilingKnown = true;
    for (const lift of LIFTS) {
      const a = e.attempts[lift] ?? [];
      const b = bestMade(a);
      if (b != null) subtotal += b;
      else complete = false;
      if (b == null && remaining(a) === 0 && a.length >= 3) bombed = true;
      const declared = a.filter((x) => x.result === "pending" && x.kg != null).map((x) => x.kg!);
      const top = Math.max(b ?? 0, ...declared, 0);
      if (top === 0 && remaining(a) > 0) ceilingKnown = false;
      ceiling += top;
    }
    return {
      id: e.id,
      name: e.name,
      us: !!e.us,
      subtotal,
      total: complete && !bombed ? subtotal : null,
      bombed,
      bodyweight: e.bodyweight,
      ceiling: ceilingKnown && !bombed ? ceiling : null,
      place: null as number | null,
    };
  });
  const ranked = rows
    .filter((r) => r.total != null)
    .sort((a, b) => b.total! - a.total! || (a.bodyweight ?? 999) - (b.bodyweight ?? 999));
  ranked.forEach((r, i) => (r.place = i + 1));
  return rows.sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.subtotal - a.subtotal);
}

/** Does our total `ours` beat a total `theirs` under the rules (bodyweights as known)? */
export function beats(
  ours: number,
  theirs: number,
  ourBw: number | null,
  theirBw: number | null,
  rules: FederationRules,
): boolean {
  if (ours > theirs + 1e-6) return true;
  if (ours < theirs - 1e-6) return false;
  if (rules.tieBreak === "lighter_bodyweight" && ourBw != null && theirBw != null)
    return ourBw < theirBw;
  return false;
}

export type Need = {
  goal: string;
  /** the deadlift attempt (kg) that gets it, on the increment */
  deadlift: number | null;
  /** the total it makes */
  total: number | null;
  possible: boolean;
  why: string;
};

/**
 * The deadlift our athlete needs to finish ahead of `rival` (their total as it
 * stands, or their ceiling when `assume` is "ceiling": every declared attempt
 * made). Respects the rule that an attempt is never lower than the last.
 */
export function deadliftToBeat(input: {
  entrants: Entrant[];
  usId: string;
  rivalId: string;
  rules: FederationRules;
  assume: "current" | "ceiling";
  /** the highest our athlete can realistically pull today (the high scenario, or a live read) */
  ourHighDeadlift?: number | null;
}): Need {
  const st = standings(input.entrants);
  const us = st.find((s) => s.id === input.usId);
  const rival = st.find((s) => s.id === input.rivalId);
  const usE = input.entrants.find((e) => e.id === input.usId);
  if (!us || !rival || !usE)
    return { goal: "Beat", deadlift: null, total: null, possible: false, why: "Lifter not found" };
  const theirs =
    input.assume === "ceiling"
      ? (rival.ceiling ?? rival.total ?? rival.subtotal)
      : (rival.total ?? rival.subtotal);
  const sq = bestMade(usE.attempts.squat ?? []);
  const bp = bestMade(usE.attempts.bench ?? []);
  if (sq == null || bp == null)
    return {
      goal: `Beat ${rival.name}`,
      deadlift: null,
      total: null,
      possible: false,
      why: "No squat and bench total yet",
    };
  const sub = sq + bp;
  const step = input.rules.incrementKg;
  let need = ceilTo(Math.max(0, theirs - sub), step);
  if (!beats(sub + need, theirs, us.bodyweight, rival.bodyweight, input.rules)) need += step;
  const floor = floorAttempt(usE.attempts.deadlift ?? [], input.rules);
  const dl = Math.max(need, floor ?? 0);
  const possible = !input.ourHighDeadlift || dl <= input.ourHighDeadlift;
  const tieNote =
    need > ceilTo(Math.max(0, theirs - sub), step)
      ? " (a tie isn't enough: their bodyweight isn't lighter, or isn't known)"
      : "";
  return {
    goal: `Beat ${rival.name}`,
    deadlift: dl,
    total: sub + dl,
    possible,
    why: `${rival.name} ${input.assume === "ceiling" ? "can reach" : "is on"} ${theirs} kg; squat + bench is ${sub} kg${tieNote}${possible ? "" : `. Over today's high read (${input.ourHighDeadlift} kg)`}`,
  };
}

/** The lightest deadlift attempt the rules allow next (never lower than the last attempt). */
export function floorAttempt(a: LiveAttempt[], rules: FederationRules): number | null {
  const taken = a.filter((x) => (x.result === "good" || x.result === "no_lift") && x.kg != null);
  if (!taken.length) return null;
  const last = taken[taken.length - 1];
  return last.result === "good"
    ? last.kg! + rules.incrementKg
    : rules.noLowerAfterAttempt
      ? last.kg!
      : last.kg! - rules.incrementKg;
}

/** The deadlift for a target total (a qualifying total, a total PR). */
export function deadliftForTotal(input: {
  entrant: Entrant;
  target: number;
  rules: FederationRules;
  goal: string;
  ourHighDeadlift?: number | null;
}): Need {
  const sq = bestMade(input.entrant.attempts.squat ?? []);
  const bp = bestMade(input.entrant.attempts.bench ?? []);
  if (sq == null || bp == null)
    return {
      goal: input.goal,
      deadlift: null,
      total: null,
      possible: false,
      why: "No squat and bench total yet",
    };
  const need = ceilTo(Math.max(0, input.target - sq - bp), input.rules.incrementKg);
  const dl = Math.max(need, floorAttempt(input.entrant.attempts.deadlift ?? [], input.rules) ?? 0);
  const possible = !input.ourHighDeadlift || dl <= input.ourHighDeadlift;
  return {
    goal: input.goal,
    deadlift: dl,
    total: sq + bp + dl,
    possible,
    why: `${input.target} kg needs ${dl} kg on ${sq + bp} kg of squat + bench${possible ? "" : `. Over today's high read (${input.ourHighDeadlift} kg)`}`,
  };
}

/** The deadlift for a placing: beat whoever would otherwise sit in that place (null: already there). */
export function deadliftForPlace(input: {
  entrants: Entrant[];
  usId: string;
  place: number;
  rules: FederationRules;
  assume: "current" | "ceiling";
  ourHighDeadlift?: number | null;
}): Need {
  const others = standings(input.entrants.filter((e) => e.id !== input.usId))
    .map((s) => ({ ...s, value: input.assume === "ceiling" ? (s.ceiling ?? s.total) : s.total }))
    .filter((s) => s.value != null)
    .sort((a, b) => b.value! - a.value!);
  const rival = others[input.place - 1];
  if (!rival)
    return {
      goal: `Place ${input.place}`,
      deadlift: 0,
      total: null,
      possible: true,
      why: `Fewer than ${input.place} others have a total: a total is enough`,
    };
  const need = deadliftToBeat({
    entrants: input.entrants,
    usId: input.usId,
    rivalId: rival.id,
    rules: input.rules,
    assume: input.assume,
    ourHighDeadlift: input.ourHighDeadlift,
  });
  return { ...need, goal: `Place ${input.place}` };
}
