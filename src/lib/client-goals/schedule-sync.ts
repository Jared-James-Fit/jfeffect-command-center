/**
 * Goals & Setup's "days a week" and "which days" are the program schedule,
 * not a second copy of it. The one schedule is `clients.committed_training_days`
 * (what every workout is dated by); Goals & Setup is an editor of it:
 *
 *   - `training_days_per_week` is always the number of committed days, and
 *     `available_weekdays` always includes them (plus any other days the
 *     person could train), here and in the database
 *     (`clients_sync_committed_days_to_goals`, 20270114090000).
 *   - Saving Goals & Setup with new days (`saveGoalsSetupFn`) writes the
 *     committed schedule and moves upcoming workouts onto it, like the
 *     Training Schedule card does.
 *
 * Pure, tested (goals-schedule-sync.test.ts).
 */
import { fitTrainingDays } from "@/lib/plan-days-fit";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { WEEKDAYS } from "./schema";

export type GoalsWeekday = (typeof WEEKDAYS)[number];

const CODE_TO_DAY: Record<GoalsWeekday, WeekDay> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** Goals' "mon" codes → the schedule's "Monday" names, in week order (unknown ones dropped). */
export function codesToDays(codes: readonly string[] | null | undefined): WeekDay[] {
  const set = new Set((codes ?? []).map((c) => CODE_TO_DAY[c as GoalsWeekday]).filter(Boolean));
  return WEEK_DAYS.filter((d) => set.has(d));
}

/** The schedule's "Monday" names → Goals' "mon" codes, in week order (unknown ones dropped). */
export function daysToCodes(days: readonly string[] | null | undefined): GoalsWeekday[] {
  const set = new Set(days ?? []);
  return WEEKDAYS.filter((c) => set.has(CODE_TO_DAY[c]));
}

/** Valid schedule days, de-duplicated, Monday first. */
export function weekOrder(days: readonly string[] | null | undefined): WeekDay[] {
  const set = new Set(days ?? []);
  return WEEK_DAYS.filter((d) => set.has(d));
}

export function sameDays(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const x = weekOrder(a);
  const y = weekOrder(b);
  return x.length === y.length && x.every((d, i) => d === y[i]);
}

function sameCodes(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  return sameDays(codesToDays(a), codesToDays(b));
}

/** Available days for Goals & Setup: what they said, always including the days they train. */
export function availabilityWith(
  available: readonly string[] | null | undefined,
  trainingDays: readonly string[],
): GoalsWeekday[] {
  const set = new Set<string>([...codesToDays(available), ...weekOrder(trainingDays)]);
  return daysToCodes(WEEK_DAYS.filter((d) => set.has(d)));
}

/**
 * The best `perWeek` training days: the ones they train now that they're still
 * available on, then add or drop the fewest, spread out with rest between
 * sessions, picking from their available days first (none picked = any day).
 */
export function pickTrainingDays(args: {
  current: readonly string[] | null | undefined;
  perWeek: number | null | undefined;
  available?: readonly string[] | null;
}): WeekDay[] {
  return fitTrainingDays(weekOrder(args.current), args.perWeek, {
    allowed: codesToDays(args.available),
  }).days;
}

/**
 * What a Goals & Setup save does to the schedule: the committed days it asks
 * for, or `null` to leave the schedule as it is.
 *
 *   - `trainingDays` (the exact days picked in Goals & Setup) win.
 *   - Otherwise a changed "days a week" or "which days" (against the row the
 *     person was looking at) is fitted onto the current schedule: an older app
 *     or another caller that only sends those still moves the schedule.
 *   - Nothing changed: the schedule stays.
 */
export function scheduleForGoalsSave(args: {
  live: readonly string[] | null | undefined;
  stored: {
    training_days_per_week?: number | null;
    available_weekdays?: readonly string[] | null;
  } | null;
  patch: { training_days_per_week?: number | null; available_weekdays?: readonly string[] | null };
  trainingDays?: readonly string[] | null;
}): WeekDay[] | null {
  const live = weekOrder(args.live);
  const explicit = weekOrder(args.trainingDays);
  if (explicit.length) return sameDays(explicit, live) ? null : explicit;

  const { patch, stored } = args;
  const countChanged =
    patch.training_days_per_week != null &&
    patch.training_days_per_week !== (stored?.training_days_per_week ?? null);
  const availableChanged =
    patch.available_weekdays != null &&
    patch.available_weekdays.length > 0 &&
    !sameCodes(patch.available_weekdays, stored?.available_weekdays ?? []);
  if (!countChanged && !availableChanged) return null;

  const perWeek = patch.training_days_per_week ?? stored?.training_days_per_week ?? live.length;
  if (!perWeek) return null;
  const days = pickTrainingDays({
    current: live,
    perWeek,
    available: patch.available_weekdays ?? stored?.available_weekdays ?? null,
  });
  return days.length && !sameDays(days, live) ? days : null;
}

/** What Goals & Setup says for a schedule (null when there's no schedule yet). */
export function goalsForSchedule(
  days: readonly string[] | null | undefined,
  available: readonly string[] | null | undefined,
): { training_days_per_week: number; available_weekdays: GoalsWeekday[] } | null {
  const d = weekOrder(days);
  if (!d.length) return null;
  return { training_days_per_week: d.length, available_weekdays: availabilityWith(available, d) };
}
