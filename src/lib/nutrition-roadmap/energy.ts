/**
 * Energy and macros, deterministic and testable.
 *
 * Maintenance starts as an estimate (Mifflin–St Jeor resting energy × an
 * activity factor read from their training days and steps) and is replaced by
 * what their own data says as soon as it says anything: logged intake, or the
 * plan they stick to, minus the energy in their weight trend (about 7,700 kcal
 * a kg; observedMaintenance in nutrition-intel.ts). The formula is ±10–15% for
 * an individual, so it's only ever a starting point, and the band says so.
 *
 * Macros follow sports nutrition guidance for lifters (ISSN position stands on
 * protein and diets, Helms et al. 2014 for contest prep): protein 1.8–2.4 g/kg
 * (higher in a deficit, where it protects muscle), fat at least 20–25% of
 * calories and never under 0.6 g/kg, carbohydrate the rest, kept as high as
 * training needs. A carb split between training and rest days is offered only
 * when it materially helps (3–5 training days a week, enough carbs to move).
 *
 * Guardrails are physiological, not a fixed number: a day is never planned
 * under their estimated resting energy, nor more than 25% under maintenance
 * (the low-energy-availability risk zone the IOC REDs consensus warns about).
 * No body-fat percentage, lean mass or metabolic rate is ever invented: with
 * no height or age, the estimate is wide and says what would tighten it.
 * Pure.
 */
import type { Maintenance } from "@/lib/nutrition-targets/nutrition-intel";
import type { Confidence, EnergyEstimate, Macros } from "@/lib/nutrition-roadmap/types";

export const KCAL_PER_KG = 7700;
/** A day's intake never more than this far under maintenance. */
export const MAX_DEFICIT_SHARE = 0.25;
/** Maintenance moves about this much per kg of bodyweight lost or gained (resting energy and the cost of moving it). */
export const KCAL_PER_KG_BODYWEIGHT = 20;

export const r25 = (n: number) => Math.round(n / 25) * 25;
const r5 = (n: number) => Math.round(n / 5) * 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Mifflin–St Jeor resting energy; null without height, age and sex. */
export function restingEnergy(x: { sex: "M" | "F" | null; age: number | null; heightCm: number | null; kg: number }): number | null {
  if (!x.sex || x.age == null || !x.heightCm || x.heightCm < 120 || x.heightCm > 230) return null;
  const base = 10 * x.kg + 6.25 * x.heightCm - 5 * x.age;
  return Math.round(base + (x.sex === "M" ? 5 : -161));
}

/** Activity factor from steps and training days: 1.3 for a desk day, up past 1.8 for a very active one. */
export function activityFactor(x: { steps: number | null; trainingDays: number }): number {
  const s = x.steps;
  const base = s == null ? 1.4 : s < 5000 ? 1.3 : s < 7500 ? 1.4 : s < 10000 ? 1.5 : s < 13000 ? 1.6 : 1.7;
  return Math.round(clamp(base + 0.03 * clamp(x.trainingDays, 0, 7), 1.3, 1.9) * 100) / 100;
}

/**
 * Their maintenance, as well as the records can tell it. Observed beats the
 * formula; a high-confidence observation is used as it is, a weaker one is
 * blended with the formula.
 */
export function estimateEnergy(x: {
  sex: "M" | "F" | null;
  age: number | null;
  heightCm: number | null;
  kg: number;
  trainingDays: number;
  steps: number | null;
  observed: Maintenance | null;
}): EnergyEstimate {
  const rmr = restingEnergy(x);
  const pal = activityFactor(x);
  const formula = rmr != null ? rmr * pal : null;
  const obs = x.observed;
  let kcal: number;
  let band: number;
  let source: EnergyEstimate["source"];
  let confidence: Confidence;
  let why: string;
  if (obs && obs.confidence === "high") {
    kcal = obs.kcal;
    band = 0.05;
    source = "observed";
    confidence = "high";
    why = `From their own results: ${obs.why}.`;
  } else if (obs && formula != null) {
    const w = obs.confidence === "moderate" ? 0.7 : 0.4;
    kcal = obs.kcal * w + formula * (1 - w);
    band = obs.confidence === "moderate" ? 0.08 : 0.1;
    source = "blend";
    confidence = obs.confidence === "moderate" ? "moderate" : "low";
    why = `Their results (${obs.why}) blended with an estimate from height, age and activity.`;
  } else if (obs) {
    kcal = obs.kcal;
    band = obs.confidence === "moderate" ? 0.08 : 0.12;
    source = "observed";
    confidence = obs.confidence === "moderate" ? "moderate" : "low";
    why = `From their own results: ${obs.why}.`;
  } else if (formula != null) {
    kcal = formula;
    band = 0.12;
    source = "formula";
    confidence = "low";
    why = `Estimated from height, age, sex and activity (resting ${rmr} kcal × ${pal}). Their weigh-ins will correct it within 2–4 weeks.`;
  } else {
    // no height, age or sex: a bodyweight rule of thumb, wide, and it says what would tighten it
    kcal = x.kg * (29 + 0.7 * clamp(x.trainingDays, 0, 7));
    band = 0.2;
    source = "bodyweight";
    confidence = "low";
    why = "A rough estimate from bodyweight alone. Height, date of birth and sex make it far better; weigh-ins correct it within a few weeks.";
  }
  kcal = r25(kcal);
  const floorKcal = r25(Math.max(rmr ?? 0, kcal * (1 - MAX_DEFICIT_SHARE)));
  return { kcal, lowKcal: r25(kcal * (1 - band)), highKcal: r25(kcal * (1 + band)), source, confidence, rmr, floorKcal, why };
}

/** Maintenance at another bodyweight (forecast blocks after a change). */
export function maintenanceAt(e: EnergyEstimate, fromKg: number, atKg: number): number {
  return r25(e.kcal + (atKg - fromKg) * KCAL_PER_KG_BODYWEIGHT);
}

/**
 * The bodyweight protein and fat are worked from. With a height on file and
 * a BMI over 30, the weight at a BMI of 27 (an adjusted weight, so protein
 * isn't overstated by tissue that doesn't need it); otherwise bodyweight.
 * Never a body-fat estimate.
 */
export function referenceKg(kg: number, heightCm: number | null): number {
  if (!heightCm) return kg;
  const m = heightCm / 100;
  const bmi = kg / (m * m);
  return bmi > 30 ? Math.round(27 * m * m * 10) / 10 : kg;
}

export type MacroContext = {
  kcal: number;
  kg: number;
  heightCm: number | null;
  /** The block's energy against maintenance: negative is a deficit. */
  vsMaintenance: number;
  /** Late contest prep: leaner, so protein a little higher. */
  lean?: boolean;
  /** Powerlifting or another weight-class sport: in a deficit, fats come down before carbs. */
  strengthSport?: boolean;
};

/** Protein g/kg by the block's energy. */
export function proteinPerKg(c: Pick<MacroContext, "vsMaintenance" | "lean">): number {
  if (c.vsMaintenance < -100) return c.lean ? 2.4 : 2.2;
  if (c.vsMaintenance > 100) return 1.8;
  return 2.0;
}

/** Protein, fat and carbs for a day's calories. */
export function macrosFor(c: MacroContext): Macros & { notes: string[] } {
  const ref = referenceKg(c.kg, c.heightCm);
  const notes: string[] = [];
  let protein = Math.min(260, r5(ref * proteinPerKg(c)));
  const deficit = c.vsMaintenance < -100;
  const fatShare = deficit ? (c.strengthSport ? 0.2 : 0.22) : 0.25;
  const fatFloor = Math.max(0.6 * ref, (0.2 * c.kcal) / 9);
  let fat = r5(Math.max(fatFloor, (fatShare * c.kcal) / 9));
  let carbs = (c.kcal - protein * 4 - fat * 9) / 4;
  // keep carbohydrate available for training: protein comes down toward 1.8 g/kg, then fat to its floor
  const carbFloor = 2 * c.kg;
  if (carbs < carbFloor) {
    const minProtein = r5(ref * 1.8);
    const give = Math.min(protein - minProtein, Math.max(0, (carbFloor - carbs) * 4) / 4);
    if (give > 0) {
      protein -= r5(give);
      carbs += r5(give);
    }
    if (carbs < carbFloor) {
      const fatMin = r5(fatFloor);
      const giveFat = Math.max(0, Math.min(fat - fatMin, ((carbFloor - carbs) * 4) / 9));
      fat -= r5(giveFat);
      carbs = (c.kcal - protein * 4 - fat * 9) / 4;
    }
    if (carbs < 1.5 * c.kg) notes.push("Carbohydrate is low for heavy training at these calories: expect harder sessions, and keep most of it around training.");
  }
  carbs = Math.max(0, r5(carbs));
  return { kcal: r25(c.kcal), proteinG: protein, carbsG: carbs, fatG: fat, notes };
}

/**
 * Training days and rest days: the same protein and fat, carbs moved toward
 * training (+8% calories on a training day), the week's average unchanged.
 * Null when it wouldn't help: under 3 or over 5 training days, or rest-day
 * carbs that would fall under 1.5 g/kg.
 */
export function splitDays(avg: Macros, trainingDays: number, kg: number, minKcal = 0): { training: Macros; rest: Macros } | null {
  if (trainingDays < 3 || trainingDays > 5) return null;
  const restDays = 7 - trainingDays;
  // never take a rest day under the floor: the split shrinks first
  const roomDown = Math.max(0, avg.kcal - minKcal);
  const up = r25(Math.min(avg.kcal * 0.08, (roomDown * restDays) / trainingDays));
  if (up < 50) return null;
  const down = r25((up * trainingDays) / restDays);
  if (avg.kcal - down < minKcal) return null;
  const tCarbs = avg.carbsG + Math.round(up / 4);
  const rCarbs = avg.carbsG - Math.round(down / 4);
  if (rCarbs < 1.5 * kg) return null;
  return {
    training: { kcal: avg.kcal + up, proteinG: avg.proteinG, fatG: avg.fatG, carbsG: r5(tCarbs) },
    rest: { kcal: avg.kcal - down, proteinG: avg.proteinG, fatG: avg.fatG, carbsG: r5(rCarbs) },
  };
}

/** The kcal a day a weekly rate takes (negative = a deficit). */
export const kcalForRate = (kgPerWeek: number) => r25((kgPerWeek * KCAL_PER_KG) / 7);
/** The weekly rate a daily kcal difference gives. */
export const rateForKcal = (kcalPerDay: number) => (kcalPerDay * 7) / KCAL_PER_KG;
