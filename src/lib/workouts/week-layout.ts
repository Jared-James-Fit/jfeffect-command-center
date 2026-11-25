/**
 * The Workouts week, two ways (Nov 25 2026): the horizontal Monday–Sunday
 * calendar (the strip, the default) or the vertical list (one row a day,
 * week-split.ts). One toggle beside the week's arrows switches them; the
 * choice is the person's, remembered on their account with the other
 * calendar views (calendar-prefs.ts `workoutsWeek`). Pure and tested in
 * workouts-week-layout.test.ts.
 */
import { addWeeks, isSameWeek } from "date-fns";

export type WeekLayout = "calendar" | "list";
export const DEFAULT_WEEK_LAYOUT: WeekLayout = "calendar";

/** Anything the app doesn't recognise (nothing saved yet, an old value) is the calendar. */
export function weekLayoutOf(v: unknown): WeekLayout {
  return v === "list" ? "list" : DEFAULT_WEEK_LAYOUT;
}

/**
 * ‹ / ›: the same weekday a week over, except that landing on the current
 * week picks today (that's the day anyone wants when they come back to it).
 * `today` is the start of today, so the picked day compares by date.
 */
export function stepWeek(selected: Date, dir: 1 | -1, today: Date): Date {
  const next = addWeeks(selected, dir);
  return isSameWeek(next, today, { weekStartsOn: 1 }) ? today : next;
}

/**
 * The list is taller than a phone's screen, so its picked day's card can sit
 * below the fold. A tap brings it up only when less than this much of it
 * shows above the tab bar; otherwise nothing moves under the finger.
 */
export const REVEAL_MIN_VISIBLE_PX = 120;

export function needsReveal(cardTop: number, visibleBottom: number): boolean {
  return cardTop > visibleBottom - REVEAL_MIN_VISIBLE_PX;
}
