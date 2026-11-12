/**
 * The supplement advice's input (supplements.ts) from what's on file: the
 * health profile, the food history, the client's basics and their next meet.
 * One builder for the AI plan, the coach's "Suggest from their record" and the
 * review, so they always agree. Pure.
 */
import type { HealthEntry, HealthProfile } from "@/lib/health/health-profile";
import { liveAllergens, type FoodHistory } from "@/lib/nutrition-targets/food-history";
import type { SupplementInput } from "@/lib/nutrition-targets/supplements";

/** Their last weekly check-ins: how many, and how many flagged sleep, digestion or energy. */
export type CheckinFlags = { total: number; sleep: number; digestion: number; energy: number };

/** How many check-ins back the flags count. */
export const FLAG_CHECKINS = 8;

export function checkinFlags(checkins: Array<{ submitted_at: string | null; answers: Record<string, unknown> | null }>): CheckinFlags {
  const recent = checkins
    .filter((c) => c.submitted_at)
    .slice()
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
    .slice(0, FLAG_CHECKINS);
  const count = (re: RegExp) =>
    recent.filter((c) => Array.isArray(c.answers?.recovery_flags) && (c.answers!.recovery_flags as unknown[]).some((f) => re.test(String(f)))).length;
  return { total: recent.length, sleep: count(/sleep/i), digestion: count(/digest|bloat/i), energy: count(/energy/i) };
}

export type MeetInfo = { isPowerlifter: boolean; meetInDays: number | null; weightClass: boolean };

const text = (xs: HealthEntry[]) => xs.map((e) => [e.label, e.area, e.details].filter(Boolean).join(" ")).join("; ");

export function supplementInput(opts: {
  health: HealthProfile;
  history: Pick<FoodHistory, "allergies" | "diets" | "preferences">;
  sex?: string | null;
  age?: number | null;
  weightKg?: number | null;
  lifts: boolean;
  meet?: MeetInfo | null;
  /** The plan's foods (its meal text); their latest food answer is added. */
  foods?: string | null;
  kcal?: number | null;
  flags?: CheckinFlags | null;
}): SupplementInput {
  const h = opts.health;
  const sex = /^f/i.test(String(opts.sex ?? "")) ? "female" : /^m/i.test(String(opts.sex ?? "")) ? "male" : null;
  return {
    sex,
    age: opts.age ?? null,
    weightKg: opts.weightKg ?? null,
    lifts: opts.lifts,
    competes: !!opts.meet?.isPowerlifter || opts.meet?.meetInDays != null,
    drugTested: h.drugTested,
    meetInDays: opts.meet?.meetInDays ?? null,
    weightClass: !!opts.meet?.weightClass,
    diets: opts.history.diets.filter((d) => !d.dismissed).map((d) => d.label),
    allergies: liveAllergens(opts.history as FoodHistory),
    health: [text(h.injuries), text(h.conditions)].filter(Boolean).join("; "),
    medications: text(h.medications),
    takes: text(h.supplements),
    foods: [opts.foods ?? "", opts.history.preferences[0]?.text ?? ""].filter(Boolean).join("\n"),
    // a meal plan says what they eat; a food answer alone doesn't rule anything out
    planGiven: String(opts.foods ?? "").trim().length > 40,
    kcal: opts.kcal ?? null,
    checkins: opts.flags ?? undefined,
    budget: h.budget,
  };
}
