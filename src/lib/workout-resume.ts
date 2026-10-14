/**
 * The workout being logged, as the Workout Session clock stores it
 * (WorkoutTimer.tsx): `workout-active-day` names the day with a running
 * session, `wsession:<dayId>` holds its clock. Finishing a workout clears both.
 */
export const WORKOUT_SESSION_PREFIX = "wsession:";
export const ACTIVE_WORKOUT_DAY_KEY = "workout-active-day";

/**
 * A fresh launch within this long of the workout last being on screen goes
 * back to it instead of Crew: iOS can close the app in the background while
 * you're in Spotify mid-workout, and coming back must land on the sets.
 */
export const RESUME_WORKOUT_WITHIN_MS = 2 * 60 * 60 * 1000;

/** The day of an unfinished workout that was on screen in the last 2 hours, or null. */
export function inProgressWorkoutDay(now: number = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  try {
    const dayId = localStorage.getItem(ACTIVE_WORKOUT_DAY_KEY);
    if (!dayId) return null;
    const raw = localStorage.getItem(WORKOUT_SESSION_PREFIX + dayId);
    const s = raw ? JSON.parse(raw) : null;
    const seen = Number(s?.lastSeenAt ?? s?.startedAt);
    if (!Number.isFinite(seen) || seen <= 0) return null;
    return now - seen <= RESUME_WORKOUT_WITHIN_MS ? dayId : null;
  } catch {
    return null;
  }
}
