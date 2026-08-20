/**
 * Canonical CLIENT-SIDE nutrition day-type resolution.
 *
 * Read-only. This module never writes coach data — it only decides which
 * coach-authored nutrition day (Training / Non-Training / High) applies to a
 * given local date so the client Nutrition page can show one consistent
 * selected day across targets, meal plan, water and instructions.
 *
 * Priority (highest first):
 *   1. Exact-date `nutrition_day_overrides` row for that date
 *   2. The configured High Day weekday (`clients.preferred_high_days`)
 *   3. A scheduled training workout on that date
 *   4. Non-Training
 *
 * `DEFAULT_HIGH_WEEKDAY` is used ONLY when the coach has made no selection at
 * all. It is never persisted and never overrides an exact-date override.
 */

import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";

export type ClientNutritionDayType = "training" | "non_training" | "high";

export const DEFAULT_HIGH_WEEKDAY: WeekDay = "Saturday";

const SUNDAY_FIRST: WeekDay[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as WeekDay[];

export type DayOverrideRow = { override_date: string; day_label?: string | null };

export type ResolveInput = {
  /** Local ISO date (YYYY-MM-DD). */
  dateISO: string;
  /** Exact-date overrides for this client. */
  overrides?: DayOverrideRow[] | null;
  /** `clients.preferred_high_days`. */
  preferredHighDays?: string[] | null;
  /** Local ISO dates that have a scheduled workout. */
  workoutDates?: string[] | null;
  /**
   * Whether the training schedule was actually loaded. When false the result
   * is flagged `suggested` so the UI can show a "Suggested" state instead of
   * claiming certainty.
   */
  scheduleKnown?: boolean;
};

export type DayResolution = {
  dayType: ClientNutritionDayType;
  source: "override" | "high_day" | "workout" | "default";
  /** Configured High Day weekday (or the fallback when none is configured). */
  highWeekday: WeekDay;
  /** True when no coach High Day selection exists and the fallback is used. */
  highWeekdayIsFallback: boolean;
  /** True when the schedule was unavailable, so the day type is a suggestion. */
  suggested: boolean;
};

export function weekdayForISO(dateISO: string): WeekDay {
  const d = new Date(`${dateISO}T00:00:00`);
  return SUNDAY_FIRST[d.getDay()];
}

function normalizeWeekday(raw: unknown): WeekDay | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (
    ((WEEK_DAYS as readonly string[]).find((d) => d.toLowerCase() === value) as
      WeekDay | undefined) ?? null
  );
}

/**
 * Map any free-text day label ("HIGH-DAY MENU", "Non-Training Day", "Rest")
 * onto a canonical day type. Order matters: "non-training" contains
 * "training", so the negative form is checked first.
 */
export function normalizeDayLabel(label: string | null | undefined): ClientNutritionDayType | null {
  const s = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s.includes("high")) return "high";
  if (s.includes("non-training") || s.includes("non training") || s.includes("nontraining"))
    return "non_training";
  if (s.includes("rest") || s.includes("off day")) return "non_training";
  if (s.includes("training") || s.includes("workout") || s.includes("lifting")) return "training";
  return null;
}

/** Configured High Day weekday, falling back only when nothing is set. */
export function configuredHighWeekday(preferredHighDays?: string[] | null): {
  weekday: WeekDay;
  isFallback: boolean;
} {
  const valid = (preferredHighDays ?? []).map(normalizeWeekday).filter(Boolean) as WeekDay[];
  if (valid.length > 0) return { weekday: valid[0], isFallback: false };
  return { weekday: DEFAULT_HIGH_WEEKDAY, isFallback: true };
}

export function resolveClientNutritionDay({
  dateISO,
  overrides,
  preferredHighDays,
  workoutDates,
  scheduleKnown = true,
}: ResolveInput): DayResolution {
  const high = configuredHighWeekday(preferredHighDays);

  const override = (overrides ?? []).find((o) => o?.override_date === dateISO);
  const overrideType = normalizeDayLabel(override?.day_label);
  if (overrideType) {
    return {
      dayType: overrideType,
      source: "override",
      highWeekday: high.weekday,
      highWeekdayIsFallback: high.isFallback,
      suggested: false,
    };
  }

  if (weekdayForISO(dateISO) === high.weekday) {
    return {
      dayType: "high",
      source: "high_day",
      highWeekday: high.weekday,
      highWeekdayIsFallback: high.isFallback,
      // A fallback-derived High Day is a suggestion, not a coach instruction.
      suggested: high.isFallback,
    };
  }

  const hasWorkout = (workoutDates ?? []).includes(dateISO);
  return {
    dayType: hasWorkout ? "training" : "non_training",
    source: hasWorkout ? "workout" : "default",
    highWeekday: high.weekday,
    highWeekdayIsFallback: high.isFallback,
    suggested: !scheduleKnown,
  };
}

export type PlanDayLike = { id?: string | null; day_label?: string | null };

/**
 * Index of the coach plan day matching a day type. Returns -1 when the coach
 * did not author a day for that type (never substitutes another day).
 */
export function pickPlanDayIndex(
  days: PlanDayLike[] | null | undefined,
  dayType: ClientNutritionDayType,
): number {
  const list = days ?? [];
  return list.findIndex((d) => normalizeDayLabel(d?.day_label) === dayType);
}

/**
 * Resolves the automatic category match, then permits an explicit client
 * selection by the plan-day record ID. Titles remain display-only.
 */
export function resolvePlanDaySelection(
  days: PlanDayLike[] | null | undefined,
  automaticDayType: ClientNutritionDayType,
  manualPlanDayId: string | null | undefined,
): { automaticPlanDayId: string | null; selectedPlanDayId: string | null; isManual: boolean } {
  const list = days ?? [];
  const automaticIndex = pickPlanDayIndex(list, automaticDayType);
  const automaticPlanDayId = automaticIndex >= 0 ? (list[automaticIndex]?.id ?? null) : null;
  const selectedPlanDayId =
    manualPlanDayId && list.some((day) => day.id === manualPlanDayId)
      ? manualPlanDayId
      : automaticPlanDayId;
  return {
    automaticPlanDayId,
    selectedPlanDayId,
    isManual: selectedPlanDayId != null && selectedPlanDayId !== automaticPlanDayId,
  };
}

export const DAY_TYPE_LABEL: Record<ClientNutritionDayType, string> = {
  training: "Training",
  non_training: "Rest Day",
  high: "High Day",
};

export const DAY_TYPE_COPY: Record<ClientNutritionDayType, string> = {
  training: "Training today? Follow this plan for performance and recovery.",
  non_training: "No lifting today? Follow this plan.",
  high: "This is your coach-planned higher-calorie day.",
};

export const DAY_TYPE_INFO =
  "Your coach may set different nutrition targets for training days, rest days, and one weekly High Day. Follow the category that matches today.";
