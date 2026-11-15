/**
 * Date math for the coach's Home calendar card views (Day / Week / Month).
 * Plain yyyy-mm-dd strings, no time zones: these are the device's calendar
 * days, like the rest of the card. Pure, so it's tested.
 */
import { weekDays } from "@/components/calendar/week-strip";
import { addDaysISO } from "@/lib/schedule-time";
import type { HomeView } from "@/lib/calendar-prefs";

/** Days ahead the Day view's "Coming up" looks. */
export const AHEAD_DAYS = 7;

/** yyyy-mm-01 of the day's month. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Same day-of-month a number of months away, clamped (Jan 31 + 1 → Feb 28/29). */
export function addMonthsISO(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** The month as whole Monday–Sunday weeks (5 or 6 rows), like the Calendar page. */
export function monthGridDays(day: string): string[] {
  const first = monthStart(day);
  const nextFirst = monthStart(addMonthsISO(first, 1));
  const start = weekDays(first)[0];
  const out: string[] = [];
  for (let d = start; ; d = addDaysISO(d, 1)) {
    out.push(d);
    if (out.length % 7 === 0 && addDaysISO(d, 1) >= nextFirst) break;
  }
  return out;
}

/**
 * The days a view needs loaded. Day: the shown day's week (its strip) and this
 * week through a week ahead (Coming up).
 */
export function homeRange(view: HomeView, anchor: string, today: string): { from: string; to: string } {
  if (view === "week") {
    const days = weekDays(anchor);
    return { from: days[0], to: days[6] };
  }
  if (view === "month") {
    const days = monthGridDays(anchor);
    return { from: days[0], to: days[days.length - 1] };
  }
  const shown = weekDays(anchor);
  const ahead = addDaysISO(today, AHEAD_DAYS);
  const thisWeek = weekDays(today)[0];
  return { from: shown[0] < thisWeek ? shown[0] : thisWeek, to: shown[6] > ahead ? shown[6] : ahead };
}

/** Move the view one step: a day, a week or a month. */
export function shiftAnchor(view: HomeView, anchor: string, step: -1 | 1): string {
  if (view === "week") return addDaysISO(anchor, 7 * step);
  if (view === "month") return monthStart(addMonthsISO(monthStart(anchor), step));
  return addDaysISO(anchor, step);
}

/** Whether the view is showing the period today falls in (so "Today" isn't needed). */
export function isCurrentPeriod(view: HomeView, anchor: string, today: string): boolean {
  if (view === "week") return weekDays(anchor).includes(today);
  if (view === "month") return anchor.slice(0, 7) === today.slice(0, 7);
  return anchor === today;
}

/**
 * "Today", "Tomorrow", "Wed, Nov 18" for a day; "Nov 9 – 15", "Nov 30 – Dec 6"
 * for a week; "November" ("November 2027" when not this year) for a month.
 */
export function periodLabel(view: HomeView, anchor: string, today: string): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o);
  if (view === "day") {
    if (anchor === today) return "Today";
    if (anchor === addDaysISO(today, 1)) return "Tomorrow";
    if (anchor === addDaysISO(today, -1)) return "Yesterday";
    const sameYear = anchor.slice(0, 4) === today.slice(0, 4);
    return fmt(anchor, sameYear ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  if (view === "month") {
    const sameYear = anchor.slice(0, 4) === today.slice(0, 4);
    return fmt(monthStart(anchor), sameYear ? { month: "long" } : { month: "long", year: "numeric" });
  }
  const days = weekDays(anchor);
  const [a, b] = [days[0], days[6]];
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return `${fmt(a, { month: "short", day: "numeric" })} – ${sameMonth ? Number(b.slice(8)) : fmt(b, { month: "short", day: "numeric" })}`;
}

/** "Today", "Tmrw", else "Mon 9": the day beside a day's first row. */
export function dayTag(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDaysISO(today, 1)) return "Tmrw";
  const d = new Date(`${day}T00:00:00`);
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`;
}
