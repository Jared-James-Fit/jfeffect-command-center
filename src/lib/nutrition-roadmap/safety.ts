/**
 * Who needs a qualified professional before (or alongside) a nutrition plan,
 * and when the plan must not get more restrictive. Screened from what's on
 * file: their age, height and weight, the health profile and forms (the same
 * terms the Nutrition Update AI screens for, safetyNotes), and what their
 * check-ins say about energy and their cycle. A flag never diagnoses
 * anything; it decides how careful the plan is and who to see.
 *
 * Low energy availability (IOC REDs consensus, 2023): missed or irregular
 * periods, persistent low energy or frequent illness while losing quickly,
 * or eating under resting energy are signs to stop cutting and get a review,
 * never a reason to cut harder. Minors, pregnancy and breastfeeding, and any
 * eating-disorder history get no weight-loss plan from the app at all.
 * Pure.
 */
import { safetyNotes } from "@/lib/nutrition-targets/nutrition-intel";
import type { Safety, SafetyFlag } from "@/lib/nutrition-roadmap/types";

export type SafetyInput = {
  age: number | null;
  sex: "M" | "F" | null;
  heightCm: number | null;
  kg: number | null;
  /** Health conditions, medications and form answers, in their words. */
  healthTexts: string[];
  /** Weekly check-ins, newest first: low energy flagged, sleep flagged. */
  recentLowEnergy: number;
  recentChecks: number;
  /** Their roadmap check-in said their cycle changed (missed / irregular periods). */
  cycleChanged: boolean;
  /** Their own ill-health reports in check-ins ("sick", "injured"), recent. */
  illness: boolean;
  /** Losing, % of bodyweight a week, from a clear trend (negative). */
  trendPctPerWeek: number | null;
  /** Planned intake on an average day, and their estimated resting energy. */
  intakeKcal: number | null;
  rmr: number | null;
  /** The goal or phase means losing weight. */
  losing: boolean;
};

const REFER = "a doctor or registered dietitian";

export function screenSafety(x: SafetyInput): Safety {
  const flags: SafetyFlag[] = [];
  const add = (key: string, severity: SafetyFlag["severity"], text: string) => {
    if (!flags.some((f) => f.key === key)) flags.push({ key, severity, text });
  };

  if (x.age != null && x.age < 18) add("minor", "refer", `Under 18: any weight change is planned with ${REFER} and a parent or guardian. The app plans fueling for training and growth only.`);

  for (const note of safetyNotes(x.healthTexts.map((value) => ({ label: "health", value })))) {
    if (note === "eating disorder history or signs") add("eating_disorder", "refer", `Eating disorder history or signs on file: no weight-loss targets from the app. Work with ${REFER} who knows this history.`);
    else if (note === "pregnancy or breastfeeding") add("pregnancy", "refer", `Pregnancy or breastfeeding: energy needs go up, never down. Plan nutrition with ${REFER}.`);
    else add(`medical:${note}`, "caution", `${note[0].toUpperCase()}${note.slice(1)} on file: keep changes small and plan them with ${REFER}.`);
  }

  if (x.kg && x.heightCm) {
    const m = x.heightCm / 100;
    const bmi = x.kg / (m * m);
    if (bmi < 18.5 && x.losing) add("low_bmi", "refer", "Bodyweight is already low for their height: losing more isn't planned. A doctor or sports dietitian should be involved in any cut.");
  }

  if (x.cycleChanged) add("reds_cycle", "refer", "A change to their menstrual cycle (missed or irregular periods) can be a sign of low energy availability. No further cutting: eat closer to maintenance and see a doctor or sports dietitian.");

  const fastLoss = x.trendPctPerWeek != null && x.trendPctPerWeek <= -1;
  if (x.recentChecks >= 2 && x.recentLowEnergy >= 2 && (fastLoss || (x.intakeKcal != null && x.rmr != null && x.intakeKcal < x.rmr)))
    add("reds_energy", "caution", "Low energy most weeks while losing quickly: a sign energy intake is too low for their training. Don't cut further until it improves.");

  if (x.intakeKcal != null && x.rmr != null && x.intakeKcal < x.rmr * 0.95 && x.losing)
    add("under_rmr", "caution", `The current intake is under their estimated resting energy (${x.rmr} kcal): too low to keep training and recovery going. Bring it back up before anything else.`);

  if (x.illness) add("illness", "caution", "Illness or injury reported recently: hold the plan and judge the scale once they're back to normal.");

  const noDeficit = flags.some((f) => ["minor", "eating_disorder", "pregnancy", "low_bmi", "reds_cycle"].includes(f.key));
  const conservative = noDeficit || flags.length > 0;
  const top = flags.find((f) => f.severity === "refer") ?? flags.find((f) => f.key.startsWith("medical:")) ?? null;
  return { flags, noDeficit, conservative, referral: top ? top.text : null };
}

/** Never in a plan, whatever the goal: said wherever a weigh-in is planned. */
export const WEIGH_IN_RULE =
  "Make the weight in a normal, fed and hydrated state. The app never plans dehydration, saunas, diuretics, water or sodium manipulation, or an acute cut; any acute strategy is a coach's call with qualified oversight.";
