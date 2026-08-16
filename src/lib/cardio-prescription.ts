export const CARDIO_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type CardioWeekday = (typeof CARDIO_WEEKDAYS)[number];
export type TargetMode = "auto" | "custom";
export type CompletionTarget = "time" | "steps" | "calories" | "manual";

export const INCLINE_TREADMILL_DEFAULT = {
  cardio_type: "Incline Treadmill Walk",
  duration_minutes: 15,
  incline: 5,
  speed_min_mph: 2,
  speed_max_mph: 3,
  intensity: "Zone 2",
  completion_rule: "any_target",
  client_notes: "Complete the session when ANY ONE target is reached. Stop when whichever target comes first.",
} as const;

// Transparent coaching estimates, intentionally rounded rather than pseudo-precise.
const BASELINE_DURATION_MINUTES = 15;
const BASELINE_STEPS = 1500;
const BASELINE_CALORIES = 100;

export function normalizeCardioWeekdays(value: unknown): CardioWeekday[] {
  const raw = Array.isArray(value) ? value : [];
  const lookup = new Map(CARDIO_WEEKDAYS.map((day) => [day.toLowerCase(), day]));
  return Array.from(new Set(raw
    .map((day) => lookup.get(String(day ?? "").trim().toLowerCase()))
    .filter((day): day is CardioWeekday => !!day)));
}

export function autoStepTarget(durationMinutes: number | null | undefined): number | null {
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((BASELINE_STEPS * duration) / BASELINE_DURATION_MINUTES / 50) * 50;
}

export function autoCalorieTarget(durationMinutes: number | null | undefined): number | null {
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.round((BASELINE_CALORIES * duration) / BASELINE_DURATION_MINUTES / 5) * 5;
}

export function resolveCardioTargets(input: {
  duration_minutes?: number | null;
  step_target?: number | null;
  calorie_target_min?: number | null;
  step_target_mode?: TargetMode | null;
  calorie_target_mode?: TargetMode | null;
}) {
  const stepMode: TargetMode = input.step_target_mode === "custom" ? "custom" : "auto";
  const calorieMode: TargetMode = input.calorie_target_mode === "custom" ? "custom" : "auto";
  return {
    stepMode,
    calorieMode,
    steps: stepMode === "custom" ? input.step_target ?? null : autoStepTarget(input.duration_minutes),
    calories: calorieMode === "custom" ? input.calorie_target_min ?? null : autoCalorieTarget(input.duration_minutes),
  };
}

export function resolveCompletionTarget(input: {
  duration_minutes?: number | null;
  step_target?: number | null;
  calorie_target_min?: number | null;
  logged_duration_minutes?: number | null;
  logged_steps?: number | null;
  logged_calories?: number | null;
}): CompletionTarget | null {
  if (Number(input.duration_minutes) > 0 && Number(input.logged_duration_minutes) >= Number(input.duration_minutes)) return "time";
  if (Number(input.step_target) > 0 && Number(input.logged_steps) >= Number(input.step_target)) return "steps";
  if (Number(input.calorie_target_min) > 0 && Number(input.logged_calories) >= Number(input.calorie_target_min)) return "calories";
  return null;
}

export function cardioCompletionRuleLabel(): string {
  return "Complete the session when ANY ONE target is reached. Stop when whichever target comes first.";
}
