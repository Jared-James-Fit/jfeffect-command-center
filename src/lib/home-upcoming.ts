import type { CalendarItem } from "@/lib/calendar-sources";

/**
 * Client Home schedule summary.
 *
 * Home is a summary surface, NOT a week view: it shows either today's
 * remaining events or — when today is done/empty — the next one or two
 * upcoming events. Everything else lives behind "View Calendar".
 */
export type HomeUpcomingMode = "today" | "next" | "empty";

export type HomeUpcoming = {
  mode: HomeUpcomingMode;
  /** Compact rows to render (never more than `maxRows`). */
  rows: CalendarItem[];
  /** How many further items exist in the near horizon beyond `rows`. */
  moreCount: number;
};

export const HOME_MAX_TODAY_ROWS = 3;
export const HOME_MAX_NEXT_ROWS = 2;

const APPOINTMENT_KINDS = new Set(["appointment", "pt_session"]);

export function isAppointmentItem(item: Pick<CalendarItem, "kind">): boolean {
  return APPOINTMENT_KINDS.has(item.kind as string);
}

function chronological(a: CalendarItem, b: CalendarItem): number {
  return (a.date + (a.startsAt ?? "")).localeCompare(b.date + (b.startsAt ?? ""));
}

/** Keep appointments when we have to drop rows, but preserve time order. */
function trim(items: CalendarItem[], max: number): CalendarItem[] {
  if (items.length <= max) return items;
  const kept = new Set<string>();
  for (const item of items) {
    if (kept.size >= max) break;
    if (isAppointmentItem(item)) kept.add(item.id);
  }
  for (const item of items) {
    if (kept.size >= max) break;
    kept.add(item.id);
  }
  return items.filter((item) => kept.has(item.id));
}

export function selectHomeUpcoming(
  items: CalendarItem[] | null | undefined,
  options: { today: string; nowMs?: number; maxTodayRows?: number; maxNextRows?: number } = { today: "" },
): HomeUpcoming {
  const today = options.today;
  const nowMs = options.nowMs ?? Date.now();
  const maxToday = options.maxTodayRows ?? HOME_MAX_TODAY_ROWS;
  const maxNext = options.maxNextRows ?? HOME_MAX_NEXT_ROWS;

  const seen = new Set<string>();
  const active = (items ?? [])
    .filter((i) => i && i.date >= today && i.status !== "Cancelled")
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort(chronological);

  const todayItems = active.filter((i) => {
    if (i.date !== today) return false;
    if (!i.startsAt) return true; // all-day / untimed items stay visible all day
    const t = Date.parse(i.startsAt);
    return Number.isFinite(t) ? t >= nowMs - 60 * 60 * 1000 : true;
  });

  if (todayItems.length > 0) {
    const rows = trim(todayItems, maxToday);
    return { mode: "today", rows, moreCount: todayItems.length - rows.length };
  }

  const later = active.filter((i) => i.date > today);
  if (later.length === 0) return { mode: "empty", rows: [], moreCount: 0 };
  const nextDate = later[0].date;
  const nextDay = later.filter((i) => i.date === nextDate);
  const rows = trim(nextDay, maxNext);
  return { mode: "next", rows, moreCount: later.length - rows.length };
}
