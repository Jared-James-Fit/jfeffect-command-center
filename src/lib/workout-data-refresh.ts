/**
 * Everything that reads logged sets or finished workouts, marked stale in one
 * place after a set changes once its workout is finished (an edit in the
 * logger, a History fix). Marked stale, never refetched at once, so the screen
 * you're on stays put and the next one you open (Workouts, the recap, records,
 * analytics, Rankings, Home) reads the new numbers. Pure apart from the
 * QueryClient call (workout-data-refresh.test.ts holds the list).
 */
import type { QueryClient } from "@tanstack/react-query";

/** Query keys (their first part) that read logged sets or a finished workout's stored numbers. */
export const WORKOUT_DATA_KEYS: readonly string[] = [
  // the Workouts page, Home and the calendars
  "my-workouts",
  "workouts-experience-client",
  "workouts-priority-rows",
  "portal-workouts-client",
  "workout-progress",
  "hub-next-workout",
  "scheduled-workouts",
  "missed-workouts",
  "day-preview-exercises",
  "inline-workout-preview-results",
  "client-training-pattern",
  // the workout itself: its completion, recap, records, points and versions
  "pl-day-completion",
  "workout-points",
  "workout-records-review",
  "workout-versions",
  "workout-cardio-status",
  "pl-feedback-summaries",
  // history, records and what the next workout suggests
  "workout-previous-lifts",
  "workout-peek-last",
  "recent-records",
  "my-client-prs",
  "exercise-records",
  "logged-e1rm",
  "load-readiness",
  "client-exercise-unit-history",
  "client-lift-family-unit-history",
  "pl-history",
  "planner-history",
  "client-peek-record",
  "checkin-training-wins",
  // analytics (the performance lab, block summaries, recovery, cardio, running)
  "performance-sources",
  "training-load-days",
  "training-load-plan",
  "training-readiness",
  "training-time",
  "recovery-trends",
  "recovery-patterns",
  "client-recovery",
  "my-client-analytics",
  "client-analytics-head",
  "block-analytics",
  "analytics-block-days",
  "pl-day-row-block-summaries",
  "running-analytics",
  "cardio-analytics",
  "cardio-completion",
  "client-cardio-resolved",
  "athlete-weight-lifted",
  "strength-board",
  "powerlifting-career",
  "program-intel-records",
  // points, levels, Rankings and Crew's view of today's session
  "athlete-xp",
  "league-week-movement",
  "league-week-spotlight",
  "community-today-session",
];

/** Key families matched by their start ("exercise-history-cards", "pl-results-all", …). */
export const WORKOUT_DATA_PREFIXES: readonly string[] = [
  "exercise-history",
  "pl-results",
  "pl-block-summar",
  "athlete-rankings",
  "athlete-achievements",
  "lift-analyses",
];

/** The open workout's own reads, already fresh (they refetch as each set saves). */
const OPEN_WORKOUT_KEYS = new Set(["pl-day-results", "pl-day-rows", "pl-day"]);

/** Does this query read logged sets or a finished workout's stored numbers? */
export function readsWorkoutData(key0: unknown): boolean {
  if (typeof key0 !== "string" || OPEN_WORKOUT_KEYS.has(key0)) return false;
  return WORKOUT_DATA_KEYS.includes(key0) || WORKOUT_DATA_PREFIXES.some((p) => key0.startsWith(p));
}

/**
 * Mark everything that reads logged sets stale (nothing refetches now), then
 * read the open workout's completion again when there is one, so its recap
 * and status line say what the database now holds.
 */
export async function refreshWorkoutData(
  qc: QueryClient,
  opts: { dayId?: string | null } = {},
): Promise<void> {
  await qc.invalidateQueries({
    predicate: (q) => readsWorkoutData(q.queryKey?.[0]),
    refetchType: "none",
  });
  if (opts.dayId) await qc.invalidateQueries({ queryKey: ["pl-day-completion", opts.dayId] });
}

/**
 * The parts of a logged set that, changed, can move a finished workout's stored
 * numbers or captions: what was typed, never a mirror worked out from it
 * (actual_rpe_num, the kg / lb copies), which the phone fills in before the
 * database does.
 */
type SetLike = Record<string, unknown> & { id?: unknown };
const SET_FIELDS = [
  "set_index",
  "actual_reps",
  "actual_load",
  "actual_load_unit",
  "entered_value",
  "entered_unit",
  "actual_rpe",
  "actual_rir",
  "completed_duration_seconds",
  "actual_calories",
  "actual_distance_m",
  "load_type",
  "completed_at",
] as const;

/**
 * One string for a workout's logged sets and its exercises' set counts: when
 * it moves after the workout was finished, something was edited (a set's
 * numbers, a set added or taken out, an exercise added or removed).
 */
export function workoutEditSignature(
  rows: readonly SetLike[],
  results: readonly SetLike[],
): string {
  const r = [...rows]
    .map((x) => `${String(x.id)}:${String(x.sets ?? "")}`)
    .sort()
    .join(",");
  const s = [...results]
    .map(
      (x) =>
        `${String(x.id)}=${SET_FIELDS.map((f) => (x[f] == null ? "" : String(x[f]))).join("|")}`,
    )
    .sort()
    .join(",");
  return `${r}#${s}`;
}
