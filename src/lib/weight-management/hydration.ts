/**
 * Daily water, set for the person. A rest day's plain water scales with
 * bodyweight (about 30 ml a kg, tapering past 100 kg since water needs follow
 * lean mass and energy use, not fat), then a training day adds back most of
 * what the session sweats out (sweat rates run about 0.4–1.2 L an hour; the
 * aim is to keep losses under ~2% of bodyweight, not to replace every drop),
 * more for a heavy sweater or a hot gym. Sodium is mentioned only when the
 * sessions are long or sweaty enough to need it (about 300–600 mg an hour of
 * training). It never goes past what's sensible (more than about a litre an
 * hour or 5.5 L a day risks low blood sodium), it's never a weight-cut tool
 * (no water loading, no restriction), and a medical fluid restriction (heart,
 * kidney, some medications) means their doctor's number, not the app's.
 * Pure, tested.
 */
import { round } from "@/lib/weight-management/units";

export const FORMULA_VERSION = 2;
export const ML_PER_KG = 30;
export const ML_PER_KG_OVER_100 = 15;
export const FLOOR_ML = 2000;
export const REST_CAP_ML = 4000;
export const DAY_CAP_ML = 5500;
/** More than this an hour, sustained, risks low blood sodium. */
export const HOURLY_CAP_ML = 1000;

export type Climate = "temperate" | "hot";
export type SweatLevel = "light" | "average" | "heavy";

/** Litres an hour lost while lifting / walking, by how much they sweat. */
const SWEAT_L_PER_HOUR: Record<SweatLevel, number> = { light: 0.4, average: 0.6, heavy: 0.9 };
/** Share of the loss to drink back on the day. */
const REPLACE = 0.8;

export type HydrationInput = {
  bodyweightKg: number | null;
  /** Typical lifting session, minutes. */
  trainingMinutes: number | null;
  /** Cardio after lifting on a training day / on a day off, minutes. */
  trainingDayCardioMinutes?: number | null;
  restDayCardioMinutes?: number | null;
  climate?: Climate | null;
  sweat?: SweatLevel | null;
  /** A doctor-set fluid limit, or a heart or kidney condition / medication that implies one. */
  fluidRestriction?: boolean;
  /** What they've actually been drinking, ml a day (days logged). */
  recentAvgMl?: number | null;
};

export type HydrationTarget = {
  restricted: boolean;
  /** Plain water on a day off. */
  restMl: number | null;
  /** Plain water on a training day. */
  trainingMl: number | null;
  /** How much more a training day is. */
  trainingExtraMl: number | null;
  /** Coffee, tea, milk and other drinks count toward total fluid on top of this. */
  totalFluidNote: string;
  /** During a session: at most this an hour. */
  perHourCapMl: number;
  electrolytes: string | null;
  /** When they're far under it: build up instead of jumping. */
  ramp: { fromMl: number; stepMlPerWeek: number; weeks: number } | null;
  why: string[];
  version: number;
};

const r100 = (n: number) => Math.round(n / 100) * 100;

export function hydrationTarget(x: HydrationInput): HydrationTarget {
  const base: Omit<HydrationTarget, "restMl" | "trainingMl" | "trainingExtraMl" | "restricted" | "why" | "electrolytes" | "ramp"> = {
    totalFluidNote: "Plain water. Milk, coffee, tea and other drinks count toward total fluid on top of it.",
    perHourCapMl: HOURLY_CAP_ML,
    version: FORMULA_VERSION,
  };
  if (x.fluidRestriction) {
    return {
      ...base,
      restricted: true,
      restMl: null,
      trainingMl: null,
      trainingExtraMl: null,
      electrolytes: null,
      ramp: null,
      why: ["A medical fluid limit is on file: their doctor sets the number, not the app."],
    };
  }
  const why: string[] = [];
  const kg = x.bodyweightKg && x.bodyweightKg > 0 ? x.bodyweightKg : null;
  let rest = kg ? Math.min(kg, 100) * ML_PER_KG + Math.max(0, kg - 100) * ML_PER_KG_OVER_100 : 3000;
  if (!kg) why.push("No bodyweight on file: 3 L to start.");
  else why.push(`${ML_PER_KG} ml a kg of bodyweight${kg > 100 ? `, ${ML_PER_KG_OVER_100} ml past 100 kg` : ""}.`);
  if (x.climate === "hot") {
    rest += 500;
    why.push("+0.5 L for the heat.");
  }
  const sweat = x.sweat ?? "average";
  const rate = SWEAT_L_PER_HOUR[sweat] * (x.climate === "hot" ? 1.3 : 1);
  const restCardio = Math.max(0, x.restDayCardioMinutes ?? 0);
  rest += (restCardio / 60) * rate * 1000 * REPLACE;
  rest = Math.min(REST_CAP_ML, Math.max(FLOOR_ML, r100(rest)));

  const lift = Math.max(0, x.trainingMinutes ?? 75);
  const trainCardio = Math.max(0, x.trainingDayCardioMinutes ?? 0);
  const sessionHours = (lift + trainCardio) / 60;
  // the days-off cardio allowance isn't a training-day thing
  const restNoCardio = Math.min(REST_CAP_ML, Math.max(FLOOR_ML, r100(rest - (restCardio / 60) * rate * 1000 * REPLACE)));
  const training = Math.min(DAY_CAP_ML, r100(restNoCardio + sessionHours * rate * 1000 * REPLACE));
  why.push(`Training days add back about ${Math.round(REPLACE * 100)}% of an estimated ${round(rate, 1)} L an hour of sweat over ${Math.round(lift + trainCardio)} min.`);
  if (sweat !== "average") why.push(sweat === "heavy" ? "They sweat heavily." : "They sweat lightly.");

  // Lifting sweats far less than endurance work: sodium only for a heavy sweater or a hot gym past an hour, or two hours of anything.
  const minutes = lift + trainCardio;
  const electrolytes =
    minutes >= 120 || ((sweat === "heavy" || x.climate === "hot") && minutes >= 60)
      ? "Add some sodium on training days: about 300–600 mg an hour of training (an electrolyte drink, or salt on the post-workout meal). Not needed on days off."
      : null;

  let ramp: HydrationTarget["ramp"] = null;
  if (x.recentAvgMl != null && x.recentAvgMl > 0 && rest - x.recentAvgMl >= 1000) {
    const gap = rest - x.recentAvgMl;
    ramp = { fromMl: r100(x.recentAvgMl), stepMlPerWeek: 500, weeks: Math.ceil(gap / 500) };
    why.push(`They average ${round(x.recentAvgMl / 1000, 1)} L: build up about 0.5 L a week instead of jumping to it.`);
  }
  return { ...base, restricted: false, restMl: rest, trainingMl: training, trainingExtraMl: training - rest > 0 ? training - rest : 0, electrolytes, ramp, why };
}

const FLUID_LIMIT = /\b(fluid restriction|restrict(ed)? fluids?|kidney|renal|ckd|dialysis|heart failure|chf|cardiac|hyponatr\w*|furosemide|lasix|spironolactone|hydrochlorothiazide|hctz|diuretic|lithium|siadh)\b/i;

/** A heart or kidney condition, a diuretic or lithium in their health profile: water is their doctor's call. */
export function hasFluidRestriction(lines: Array<string | null | undefined>): boolean {
  return lines.some((l) => FLUID_LIMIT.test(String(l ?? "")));
}
