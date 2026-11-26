/**
 * The estimated max a "% of Est. 1RM" prescription reads when no e1RM is
 * stored on the athlete's maxes: their current estimated strength for that
 * competition lift from the Strength Intelligence engine (src/lib/strength-
 * intel: the same read the Strength tab, Program Intelligence, Cleo and the
 * competition forecast use), so the logger's "Est. 1RM" is never a number of
 * its own (pure, tested in planning-e1rm.test.ts and strength-intel.test.ts).
 *
 * It plans from the estimate only while something stands behind it (not only
 * lighter sets, two sessions or meets, enough confidence: planning.ts), and
 * for a deadlift only from their current stance's history. Otherwise the RPE
 * leads, as before. The RPE beside a % is its cap (load-reference.ts), so a
 * set that goes over it still brings the next one down.
 *
 * Jared's 60% Est. 1RM paused deadlift (Nov 25 2026) showed no weight: one
 * hard deadlift session in six weeks and a 270 kg meet pull on Sep 18. Now it
 * reads his training-day strength from that meet (the meet over his platform
 * premium), held through an RPE 6 off-season block.
 */
import type { MeetResult } from "@/lib/analytics/competition-strength";
import { billingDay } from "@/lib/date-range";
import type { LiftFamily } from "@/lib/workouts/load-reference";
import { STRENGTH_RULES } from "@/lib/strength-intel/rules";
import { buildStrengthIntel, type StrengthContext } from "@/lib/strength-intel/profile";
import { planningRefs, type E1rmSource, type PlanningRef } from "@/lib/strength-intel/planning";

export type { E1rmSource } from "@/lib/strength-intel/planning";
export type PlanningE1rm = PlanningRef;

/** How far back the read goes: long enough to hold through an off-season. */
export const E1RM_READ_DAYS = STRENGTH_RULES.READ_DAYS;
/** Sessions or meets behind the estimate before a program reads it. */
export const E1RM_MIN_POINTS = STRENGTH_RULES.PLAN_MIN_POINTS;

/**
 * Every requested lift's planning e1RM from the athlete's logged sets
 * (getClientResults' shape: `load` in lb) and meets.
 */
export function planningE1rmByFamily(
  results: any[],
  meets: MeetResult[],
  families: LiftFamily[],
  today: string,
  ctx: Omit<StrengthContext, "today"> = {},
): Partial<Record<LiftFamily, PlanningE1rm>> {
  const refs = planningRefs(buildStrengthIntel(results, meets, { ...ctx, today }));
  const out: Partial<Record<LiftFamily, PlanningE1rm>> = {};
  for (const fam of families) if (refs.e1rm[fam]) out[fam] = refs.e1rm[fam];
  return out;
}

const LIFT_WORD: Record<LiftFamily, string> = { squat: "squat", bench: "bench", deadlift: "deadlift" };
const LB_PER_KG = 2.2046226218;
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * Where the estimate came from, for the planned weight's ⓘ, in the card's unit:
 * "Your estimated max is your deadlift at Commonwealth Championships (Sep 18)."
 * "Your estimated max is worked out from 224.5 kg × 4 @ RPE 10 on Nov 13."
 */
export function e1rmSourceLine(source: E1rmSource | null | undefined, family: LiftFamily, unit: "kg" | "lb"): string | null {
  if (!source) return null;
  if (source.kind === "inferred") {
    return `Inferred from your ${LIFT_WORD[source.from as LiftFamily] ?? source.from} estimate: this lift has run about ${Math.round(source.ratio * 100)}% of it (${source.pairs} comparisons).`;
  }
  const day = billingDay(source.day) ?? source.day;
  if (source.kind === "meet") {
    return `Your estimated max is your ${LIFT_WORD[family]} at ${source.name ?? "your last meet"} (${day}).`;
  }
  const load = unit === "kg" ? source.loadLb / LB_PER_KG : source.loadLb;
  const effort = source.effort != null ? ` @ RPE ${fmt(source.effort)}` : "";
  return `Your estimated max is worked out from ${fmt(load)} ${unit} × ${source.reps}${effort} on ${day}.`;
}

/** The confidence and the last update, for the same ⓘ: "Moderate confidence · last updated Nov 13." */
export function e1rmConfidenceLine(ref: Pick<PlanningRef, "word" | "lastUpdate" | "metric"> | null | undefined): string | null {
  if (!ref?.word) return null;
  const day = ref.lastUpdate ? (billingDay(ref.lastUpdate) ?? ref.lastUpdate) : null;
  const word = ref.word.charAt(0).toUpperCase() + ref.word.slice(1);
  return `${word} confidence${day ? ` · last updated ${day}` : ""}.`;
}

const STYLE_WORD = { sumo: "sumo", conventional: "conventional" } as const;

/**
 * What the planned weight's ⓘ says about the number a % read, in the card's
 * unit: which metric it is, where it came from, how sure it is and when it
 * last moved. Never a number of its own: every word comes from the strength
 * read (strength-intel/planning.ts).
 */
export function referenceLines(ref: PlanningRef | null | undefined, family: LiftFamily | null, unit: "kg" | "lb"): string[] {
  if (!ref) return [];
  const lift = family ? LIFT_WORD[family] : "lift";
  const out: string[] = [];
  const src = ref.source;
  if (ref.metric === "comp_pr" && src?.kind === "meet") {
    const day = billingDay(src.day) ?? src.day;
    out.push(`Your competition PR: the most you've ${family === "bench" ? "benched" : family === "squat" ? "squatted" : "pulled"} on a platform, at ${src.name ?? "a meet"} (${day}).`);
    return out;
  }
  const stance = ref.style ? `${STYLE_WORD[ref.style]} ` : "";
  if (src?.kind === "inferred") {
    out.push(e1rmSourceLine(src, family ?? "squat", unit) as string);
  } else if (src?.kind === "meet") {
    const day = billingDay(src.day) ?? src.day;
    const prem = ref.premium && ref.premium > 1.001 ? ` (a peaked meet runs about ${Math.round((ref.premium - 1) * 1000) / 10}% over a training day)` : "";
    out.push(`Your current ${stance}${lift} estimate is your lift at ${src.name ?? "your last meet"} (${day}), read as training-day strength${prem}.`);
  } else if (src?.kind === "set") {
    const load = unit === "kg" ? src.loadLb / LB_PER_KG : src.loadLb;
    const effort = src.effort != null ? ` @ RPE ${fmt(src.effort)}` : "";
    const day = billingDay(src.day) ?? src.day;
    out.push(
      ref.lowerBound
        ? `Your ${stance}${lift} is at least this, from ${fmt(load)} ${unit} × ${src.reps}${effort} on ${day}: a lighter set, so this may run light. Let the RPE decide.`
        : `Your current ${stance}${lift} estimate, worked out from ${fmt(load)} ${unit} × ${src.reps}${effort} on ${day}.`,
    );
  }
  const conf = e1rmConfidenceLine(ref);
  if (conf) out.push(conf);
  return out;
}
