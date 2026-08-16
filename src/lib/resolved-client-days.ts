import { addDays } from "date-fns";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { toLocalISO, parseLocalDate } from "@/lib/today";
import { resolveWeekDayDates } from "@/lib/workout-today";

export type NutritionDayType = "training" | "high" | "non_training";
export type CardioDayType = NutritionDayType | "rest";

export type ResolvedClientDay = {
  date: string;
  clientId: string;
  hasCommittedWorkout: boolean;
  workoutId?: string;
  nutritionDayType: NutritionDayType;
  cardioDayType: CardioDayType;
  cardioTargetId?: string;
  isRecurringHighDay: boolean;
  isHighDayOverride: boolean;
  isWorkoutOverride: boolean;
};

export type ResolvedWorkoutDate = {
  date: string;
  workoutId: string;
  workout: any;
  isWorkoutOverride: boolean;
};

export type CardioTargetLike = {
  id: string;
  day_type?: string | null;
  custom_day_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  enabled?: boolean | null;
  visible_to_client?: boolean | null;
  scheduled_weekdays?: string[] | null;
};

export type DayOverrideLike = {
  override_date: string;
  day_label: string;
};

type ResolveClientWeekDaysInput = {
  clientId: string;
  weekDates: string[];
  workouts?: ResolvedWorkoutDate[];
  recurringHighDays?: string[] | null;
  highDayOverrides?: DayOverrideLike[] | null;
  fullCardioRestDays?: string[] | null;
  cardioTargets?: CardioTargetLike[] | null;
  defaultFullRestDay?: boolean;
};

const SUNDAY_FIRST: WeekDay[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function normalizeWeekday(raw: unknown): WeekDay | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return (WEEK_DAYS as readonly string[]).find((d) => d.toLowerCase() === value) as WeekDay | undefined ?? null;
}

export function weekdayNameForISO(dateISO: string): WeekDay {
  const d = parseLocalDate(dateISO) ?? new Date(`${dateISO}T00:00:00`);
  return SUNDAY_FIRST[d.getDay()];
}

export function mondayWeekDates(weekStart: Date | string): string[] {
  const start = typeof weekStart === "string" ? parseLocalDate(weekStart)! : parseLocalDate(weekStart)!;
  return WEEK_DAYS.map((_, index) => toLocalISO(addDays(start, index)));
}

function canonicalCardioDayType(dayType: string | null | undefined): CardioDayType | "general" | "custom" {
  const d = (dayType ?? "General").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (d === "training-day" || d === "training") return "training";
  if (d === "high-day" || d === "high") return "high";
  if (d === "non-training-day" || d === "nontraining-day" || d === "non-training") return "non_training";
  if (d === "rest-day" || d === "rest") return "non_training";
  if (d === "custom") return "custom";
  return "general";
}

function targetIsActiveForDate(target: CardioTargetLike, dateISO: string): boolean {
  if (target.enabled === false) return false;
  if (target.visible_to_client === false) return false;
  if ((target.status ?? "Active") !== "Active") return false;
  if (target.start_date && target.start_date > dateISO) return false;
  if (target.end_date && target.end_date < dateISO) return false;
  return true;
}

export function pickCardioTargetForDay(
  targets: CardioTargetLike[] | null | undefined,
  dayType: CardioDayType,
  dateISO: string,
): CardioTargetLike | null {
  if (dayType === "rest") return null;
  const active = (targets ?? []).filter((target) => targetIsActiveForDate(target, dateISO));
  // A saved weekday schedule is canonical. Legacy targets with no saved weekdays
  // continue through the older day-type fallback so existing prescriptions remain visible.
  const weekday = weekdayNameForISO(dateISO);
  const explicitlyScheduled = active.filter((target) => Array.isArray(target.scheduled_weekdays) && target.scheduled_weekdays.length > 0);
  const explicitlyScheduledForDay = explicitlyScheduled.find((target) =>
    target.scheduled_weekdays!.some((day) => String(day).toLowerCase() === weekday.toLowerCase()),
  );
  if (explicitlyScheduledForDay) return explicitlyScheduledForDay;

  // During the additive migration, edited targets use canonical weekdays while
  // untouched targets retain their legacy day-type rule. A saved weekday on one
  // target must not suppress a valid legacy target for a different weekday.
  const legacyActive = active.filter((target) => !Array.isArray(target.scheduled_weekdays) || target.scheduled_weekdays.length === 0);
  const exact = legacyActive.find((target) => canonicalCardioDayType(target.day_type) === dayType);
  if (exact) return exact;
  if (dayType === "non_training") {
    const customNonTraining = legacyActive.find((target) => {
      const label = `${target.day_type ?? ""} ${target.custom_day_type ?? ""}`.toLowerCase();
      return label.includes("non") && label.includes("training");
    });
    if (customNonTraining) return customNonTraining;
  }
  return legacyActive.find((target) => canonicalCardioDayType(target.day_type) === "general") ?? null;
}

export function resolveWorkoutDatesFromSchedule(
  days: any[],
  weeks: any[],
  block: any,
  committedTrainingDays?: string[] | null,
): ResolvedWorkoutDate[] {
  const byWeek = new Map<string, any[]>();
  for (const day of days ?? []) {
    if (!day?.id || !day?.week_id) continue;
    const list = byWeek.get(day.week_id) ?? [];
    list.push(day);
    byWeek.set(day.week_id, list);
  }
  const weekById = new Map<string, any>();
  for (const week of weeks ?? []) weekById.set(week.id, week);

  const out: ResolvedWorkoutDate[] = [];
  for (const [weekId, weekDays] of byWeek) {
    const week = weekById.get(weekId);
    const dateMap = resolveWeekDayDates(weekDays, week, block, committedTrainingDays);
    for (const day of weekDays) {
      const resolved = dateMap.get(day.id);
      if (!resolved) continue;
      out.push({
        date: toLocalISO(resolved),
        workoutId: day.id,
        workout: day,
        isWorkoutOverride: !!day.schedule_locked,
      });
    }
  }
  return out;
}

export function resolveWorkoutDatesFromItems(
  items: any[],
  committedTrainingDays?: string[] | null,
): ResolvedWorkoutDate[] {
  // Phase 2a: when the item carries an instance-level date, use it verbatim.
  // pl_scheduled_workouts is the canonical schedule source; falling back to
  // resolveWeekDayDates for these items would recompute a derived date and
  // undo manual moves / stacking.
  const derivedInputs: any[] = [];
  const out: ResolvedWorkoutDate[] = [];
  for (const item of items ?? []) {
    if (!item?.day?.id || !item?.week?.id) continue;
    if (item.scheduledDate) {
      out.push({
        date: item.scheduledDate,
        workoutId: item.day.id,
        workout: item.day,
        isWorkoutOverride:
          !!item.day.schedule_locked ||
          (item.scheduleSource != null && item.scheduleSource !== "program"),
      });
      continue;
    }
    derivedInputs.push(item);
  }

  const byWeek = new Map<string, any[]>();
  for (const item of derivedInputs) {
    const list = byWeek.get(item.week.id) ?? [];
    list.push(item);
    byWeek.set(item.week.id, list);
  }

  for (const [, weekItems] of byWeek) {
    const week = weekItems[0]?.week;
    const block = weekItems[0]?.block;
    const dayRows = weekItems.map((item) => item.day);
    const dateMap = resolveWeekDayDates(dayRows, week, block, committedTrainingDays);
    for (const item of weekItems) {
      const resolved = dateMap.get(item.day.id);
      if (!resolved) continue;
      out.push({
        date: toLocalISO(resolved),
        workoutId: item.day.id,
        workout: item.day,
        isWorkoutOverride: !!item.day.schedule_locked,
      });
    }
  }
  return out;
}

function chooseRestDate(
  weekDates: string[],
  workoutsByDate: Map<string, ResolvedWorkoutDate>,
  highDate: string | null,
  overrideByDate: Map<string, string>,
  fullCardioRestDays: string[] | null | undefined,
  defaultFullRestDay: boolean,
): string | null {
  const explicitRestWeekdays = new Set((fullCardioRestDays ?? []).map(normalizeWeekday).filter(Boolean));
  const isEligible = (dateISO: string, skipOverride: boolean) => {
    if (workoutsByDate.has(dateISO)) return false;
    if (dateISO === highDate) return false;
    if (skipOverride && overrideByDate.has(dateISO)) return false;
    return true;
  };

  if (explicitRestWeekdays.size > 0) {
    const explicit = weekDates.find((dateISO) => explicitRestWeekdays.has(weekdayNameForISO(dateISO)) && isEligible(dateISO, false));
    if (explicit) return explicit;
  }

  if (!defaultFullRestDay) return null;
  const eligible = weekDates.filter((dateISO) => isEligible(dateISO, true));
  return eligible[eligible.length - 1] ?? null;
}

export function resolveClientWeekDays({
  clientId,
  weekDates,
  workouts = [],
  recurringHighDays,
  highDayOverrides,
  fullCardioRestDays,
  cardioTargets,
  defaultFullRestDay = true,
}: ResolveClientWeekDaysInput): ResolvedClientDay[] {
  const workoutsByDate = new Map<string, ResolvedWorkoutDate>();
  for (const workout of workouts) {
    if (!weekDates.includes(workout.date)) continue;
    if (!workoutsByDate.has(workout.date)) workoutsByDate.set(workout.date, workout);
  }

  const overrideByDate = new Map<string, string>();
  for (const override of highDayOverrides ?? []) {
    if (override?.override_date) overrideByDate.set(override.override_date, override.day_label);
  }

  const overrideHighDate = weekDates.find((dateISO) => overrideByDate.get(dateISO) === "High Day") ?? null;
  const recurringHighWeekdays = new Set((recurringHighDays?.length ? recurringHighDays : ["Sunday"]).map(normalizeWeekday).filter(Boolean));
  const recurringHighDate = overrideHighDate
    ? null
    : weekDates.find((dateISO) => !overrideByDate.has(dateISO) && recurringHighWeekdays.has(weekdayNameForISO(dateISO))) ?? null;
  const highDate = overrideHighDate ?? recurringHighDate;
  const restDate = chooseRestDate(
    weekDates,
    workoutsByDate,
    highDate,
    overrideByDate,
    fullCardioRestDays,
    defaultFullRestDay,
  );

  return weekDates.map((dateISO) => {
    const workout = workoutsByDate.get(dateISO) ?? null;
    const isHighDayOverride = dateISO === overrideHighDate;
    const isRecurringHighDay = dateISO === recurringHighDate;
    const isHigh = isHighDayOverride || isRecurringHighDay;
    const nutritionDayType: NutritionDayType = isHigh ? "high" : workout ? "training" : "non_training";
    const cardioDayType: CardioDayType = isHigh ? "high" : dateISO === restDate ? "rest" : workout ? "training" : "non_training";
    const target = pickCardioTargetForDay(cardioTargets, cardioDayType, dateISO);
    return {
      date: dateISO,
      clientId,
      hasCommittedWorkout: !!workout,
      workoutId: workout?.workoutId,
      nutritionDayType,
      cardioDayType,
      cardioTargetId: target?.id,
      isRecurringHighDay,
      isHighDayOverride,
      isWorkoutOverride: !!workout?.isWorkoutOverride,
    };
  });
}