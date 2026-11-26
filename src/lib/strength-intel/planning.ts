/**
 * What a prescription may read from the strength read (pure, tested): the
 * numbers a "% of …" plans from, in kg, each saying which metric it is, how
 * sure it is and where it came from, so the logger, the builder and the coach's
 * quick view never read different things.
 *
 *  - e1rm (a % of Est. 1RM): their CURRENT estimated strength for the
 *    competition lift, only while something stands behind it: not only lighter
 *    sets (a floor), confidence at least PLAN_MIN_CONFIDENCE, and two sessions
 *    or meets. For a deadlift, their current stance's only: a sumo estimate is
 *    never handed to a conventional prescription.
 *  - compPr (a % of a competition PR): the most they've lifted on a platform.
 *  - variations (a % of this exercise's own e1RM): the variation's own
 *    estimate when its history is reliable; else, when 3+ sessions have shown
 *    how it runs against the competition lift, that share of the competition
 *    estimate, said to be inferred. Never a universal ratio.
 * With none, `why` says what's missing and the RPE leads.
 */
import { STRENGTH_RULES as R, confidenceWord, LB_PER_KG, dayMs, DAY_MS } from "./rules";
import type { EnvelopeState } from "./estimate";
import type { CurrentStrength, LiftIntel, StrengthIntel } from "./profile";
import type { DeadliftStyle } from "./style";

export type LiftFamily = "squat" | "bench" | "deadlift";

export type E1rmSource =
  | { kind: "meet"; day: string; name: string | null }
  | { kind: "set"; day: string; loadLb: number; reps: number; effort: number | null }
  | { kind: "inferred"; from: string; ratio: number; pairs: number };

export type PlanningMetric = "current" | "comp_pr" | "variation" | "variation_inferred";

export type PlanningRef = {
  kg: number;
  metric: PlanningMetric;
  /** 0–1, null for a competition PR (it was lifted) */
  confidence: number | null;
  word: "high" | "moderate" | "low" | null;
  state: EnvelopeState | null;
  source: E1rmSource | null;
  /** the last day evidence moved or confirmed it */
  lastUpdate: string | null;
  style: DeadliftStyle | null;
  /** only lighter sets so far: "at least" this, so a % of it may run light */
  lowerBound?: boolean;
  /** how much their platform runs over training (a meet read as training-day strength) */
  premium?: number;
  /** what today's sets say against it, when they say something ("moving well" / "heavy today"): information, never a change to the plan */
  today?: { ratio: number; word: "strong" | "heavy" } | null;
};

/** Bases that read the strength engine (the rest read the coach's maxes, today's sets or nothing). */
export const STRENGTH_BASES = ["est_1rm", "comp_pr", "var_e1rm"] as const;
export const isStrengthBasis = (b: unknown) => (STRENGTH_BASES as readonly string[]).includes(String(b ?? ""));

/**
 * What a row's % reads from the strength read, by its basis: a % of Est. 1RM
 * the competition lift's current estimate (a stored e1RM on their maxes still
 * wins, computeRowLoad), a % of a competition PR their best platform lift, a
 * % of this exercise's own e1RM the variation's own estimate. The same three
 * numbers go into computeRowLoad everywhere (the logger, the coach's quick
 * view, the builder), so nobody works a % out differently.
 */
export function strengthLoadInputs(
  refs: StrengthRefs | null | undefined,
  basis: string | null | undefined,
  family: LiftFamily | null | undefined,
  exerciseId: string | null | undefined,
): { loggedE1rmKg: number | null; compPrKg: number | null; variationE1rmKg: number | null; ref: PlanningRef | null } {
  const e1rm = family ? (refs?.e1rm[family] ?? null) : null;
  const compPr = family ? (refs?.compPr[family] ?? null) : null;
  const variation = exerciseId ? (refs?.variations[exerciseId] ?? null) : null;
  const ref = basis === "comp_pr" ? compPr : basis === "var_e1rm" ? variation : basis === "est_1rm" ? e1rm : null;
  return { loggedE1rmKg: e1rm?.kg ?? null, compPrKg: compPr?.kg ?? null, variationE1rmKg: variation?.kg ?? null, ref };
}

export type StrengthRefs = {
  e1rm: Partial<Record<LiftFamily, PlanningRef>>;
  compPr: Partial<Record<LiftFamily, PlanningRef>>;
  /** by exercise id */
  variations: Record<string, PlanningRef>;
  /** why there's no e1rm to plan from, per lift */
  why: Partial<Record<LiftFamily, string>>;
};

export const EMPTY_REFS: StrengthRefs = { e1rm: {}, compPr: {}, variations: {}, why: {} };

const kg = (lb: number) => Math.round((lb / LB_PER_KG) * 10) / 10;

function sourceOf(c: CurrentStrength): E1rmSource {
  return c.basis.kind === "meet"
    ? { kind: "meet", day: c.basis.day, name: c.basis.name }
    : { kind: "set", day: c.basis.day, loadLb: c.basis.load, reps: c.basis.reps, effort: c.basis.effort };
}

/**
 * Why a current estimate can't be planned from, or null when it can. A lower
 * bound (only lighter sets so far) is safe to plan a % from: it can only run
 * light, and the RPE decides. One session alone never is (a typed slip would
 * become the max), unless another estimate of the same lift backs it up
 * (`corroborate`: their other stance's, within 25%): a plausibility check,
 * never a number carried across.
 */
export function notPlannable(c: CurrentStrength | null, today: string, corroborate?: number | null): string | null {
  if (!c) return "No hard sets or meets on file yet.";
  const backed = corroborate != null && corroborate > 0 && c.value / corroborate >= 0.75 && c.value / corroborate <= 1.25;
  if (c.points < R.PLAN_MIN_POINTS && !backed) return "One session isn't enough to plan from.";
  if (c.state === "floor") return null;
  if (c.confidence < R.PLAN_MIN_CONFIDENCE) {
    const weeks = Math.round((dayMs(today) - dayMs(c.lastUpdate)) / DAY_MS / 7);
    return `The estimate is out of date (last hard evidence ${weeks} week${weeks === 1 ? "" : "s"} ago).`;
  }
  return null;
}

function refFrom(c: CurrentStrength, metric: PlanningMetric, style: DeadliftStyle | null, premium?: number): PlanningRef {
  return {
    kg: kg(c.value),
    metric,
    confidence: c.confidence,
    word: c.word,
    state: c.state,
    source: sourceOf(c),
    lastUpdate: c.lastUpdate,
    style,
    lowerBound: c.state === "floor",
    ...(premium ? { premium } : {}),
  };
}

const STYLE_NAME: Record<DeadliftStyle, string> = { sumo: "sumo", conventional: "conventional" };

export function planningRefs(intel: StrengthIntel): StrengthRefs {
  const refs: StrengthRefs = { e1rm: {}, compPr: {}, variations: {}, why: {} };
  for (const fam of ["squat", "bench", "deadlift"] as LiftFamily[]) {
    const l: LiftIntel | undefined = intel.lifts[fam];
    if (!l) continue;
    const other = l.otherStyle?.current ?? null;
    const why = notPlannable(l.current, intel.today, other?.value ?? null);
    if (!why && l.current) refs.e1rm[fam] = refFrom(l.current, "current", l.style, l.calibration.premium);
    else {
      refs.why[fam] =
        l.style && l.otherStyle && other && !notPlannable(other, intel.today)
          ? `No reliable ${STYLE_NAME[l.style]} history yet (your ${STYLE_NAME[l.otherStyle.style]} estimate, ${kg(other.value)} kg, is a different lift).`
          : (why ?? "No estimate yet.");
    }
    if (l.competitionPR)
      refs.compPr[fam] = {
        kg: kg(l.competitionPR.value),
        metric: "comp_pr",
        confidence: null,
        word: null,
        state: null,
        source: { kind: "meet", day: l.competitionPR.day, name: l.competitionPR.name },
        lastUpdate: l.competitionPR.day,
        style: null,
      };
  }
  for (const v of intel.variations) {
    if (v.current && !notPlannable(v.current, intel.today)) {
      refs.variations[v.exerciseId] = refFrom(v.current, "variation", null);
      continue;
    }
    const comp = refs.e1rm[v.family];
    if (v.ratio && comp && comp.confidence != null) {
      const confidence = Math.round(comp.confidence * 0.7 * 100) / 100;
      refs.variations[v.exerciseId] = {
        kg: Math.round(comp.kg * v.ratio.value * 10) / 10,
        metric: "variation_inferred",
        confidence,
        word: confidenceWord(confidence),
        state: comp.state,
        source: { kind: "inferred", from: v.family, ratio: v.ratio.value, pairs: v.ratio.pairs },
        lastUpdate: comp.lastUpdate,
        style: null,
      };
    }
  }
  return refs;
}

/** strengthLoadInputs' three numbers alone, to spread into computeRowLoad. */
export function strengthKgs(
  refs: StrengthRefs | null | undefined,
  basis: string | null | undefined,
  family: LiftFamily | null | undefined,
  exerciseId: string | null | undefined,
): { loggedE1rmKg: number | null; compPrKg: number | null; variationE1rmKg: number | null } {
  const { ref: _ref, ...kgs } = strengthLoadInputs(refs, basis, family, exerciseId);
  return kgs;
}
