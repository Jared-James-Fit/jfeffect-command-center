import { format } from "date-fns";
import { parseLocalDate } from "@/lib/today";

/**
 * Central formatting for a workout day header, used by the program builder,
 * the weekly and calendar views, and both coach- and client-facing workout
 * pages. Separates three orthogonal pieces of information that used to be
 * jammed into `pl_days.title`:
 *
 *   1. Day label      — derived from `day_index` (e.g. "Day 1").
 *   2. Workout subtitle — optional coach label (e.g. "Final Heavy").
 *   3. Training date  — resolved elsewhere; formatted here for display.
 *
 * Legacy `title` values (before the 2026-07 backfill) may still contain a
 * combined string such as "Day 1 — Monday, August 31 — Final Heavy". This
 * module never treats `title` as authoritative for the day label. When
 * `subtitle` is null we fall back to `title` as a display-only best-effort
 * so no coach-entered text goes missing on the UI.
 */

export interface DayLike {
  day_index?: number | null;
  title?: string | null;
  subtitle?: string | null;
}

export function formatDayLabel(day: DayLike | null | undefined, positionalIndex?: number): string {
  const idx =
    typeof positionalIndex === "number" && positionalIndex > 0
      ? positionalIndex
      : day?.day_index ?? null;
  return idx ? `Day ${idx}` : "Workout";
}

/**
 * Return a coach-written subtitle. Prefers the dedicated `subtitle` column;
 * falls back to `title` (legacy) only when it does not obviously encode the
 * "Day N" / weekday / date noise the migration was designed to strip.
 */
export function formatDaySubtitle(day: DayLike | null | undefined): string | null {
  const sub = (day?.subtitle ?? "").trim();
  if (sub) return sub;
  const raw = (day?.title ?? "").trim();
  if (!raw) return null;
  // If the legacy title is nothing more than "Day N", drop it — the label
  // already renders that.
  if (/^day\s*\d+$/i.test(raw)) return null;
  return raw;
}

export interface TrainingDateParts {
  weekday: string;         // "Monday"
  weekdayShort: string;    // "Mon"
  full: string;            // "August 31, 2026"
  medium: string;          // "Aug 31, 2026"
  short: string;           // "Aug 31"
  compact: string;         // "Mon, Aug 31"
  iso: string;             // "2026-08-31"
}

export function formatTrainingDate(iso: string | null | undefined): TrainingDateParts | null {
  if (!iso) return null;
  const d = parseLocalDate(iso);
  if (!d) return null;
  return {
    weekday: format(d, "EEEE"),
    weekdayShort: format(d, "EEE"),
    full: format(d, "MMMM d, yyyy"),
    medium: format(d, "MMM d, yyyy"),
    short: format(d, "MMM d"),
    compact: format(d, "EEE, MMM d"),
    iso: format(d, "yyyy-MM-dd"),
  };
}

/** Convenience used by list/card views: "Day 1 — Final Heavy" when a
 *  subtitle is present, otherwise just "Day 1". Never includes the date. */
export function formatDayCardLabel(day: DayLike | null | undefined, positionalIndex?: number): string {
  const label = formatDayLabel(day, positionalIndex);
  const sub = formatDaySubtitle(day);
  return sub ? `${label} — ${sub}` : label;
}