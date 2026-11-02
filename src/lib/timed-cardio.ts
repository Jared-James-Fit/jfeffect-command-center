/**
 * Steady cardio done for time (a walk, a bike, a treadmill), not a strength
 * movement that happens to walk or carry. Shared by the program generator
 * (it writes these as timed rows) and the workout logger (their sets get a
 * Calories box by default).
 */
const TIMED_CARDIO_RE = /\b(treadmill|walk|walking|bike|biking|cycling|cycle|elliptical|stair ?master|stair climber|stepper|rowing machine|rower|erg|jog|jogging|run|running|cardio|airbike|assault)\b/i;
const NOT_CARDIO_RE = /lunge|farmer|carry|gorilla|walkout|walk-?over|band walk|plank|crunch|kettlebell|^air bike$/i;

export function isTimedCardio(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return !!n && TIMED_CARDIO_RE.test(n) && !NOT_CARDIO_RE.test(n);
}

/** Calories a person can type for one cardio set (the database allows 0–5000). */
export const MAX_SET_CALORIES = 5000;
