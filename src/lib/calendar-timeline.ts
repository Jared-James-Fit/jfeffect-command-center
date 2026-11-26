/**
 * The coach's calendar as a timeline, Google Calendar's way: each booking is a
 * block placed at its start and as tall as it lasts, bookings at the same time
 * sit side by side, and empty space is free time. Pure (no React), so the
 * placement is tested: which minutes of a day a booking covers on the device's
 * clock, how overlapping bookings share the width, where the grid opens
 * scrolled to, and what time a tap on an empty slot means.
 *
 * Minutes are read off the local clock (hours × 60 + minutes), never as
 * milliseconds since midnight, so a day with a clock change still lines up
 * with its hour labels.
 */

export const DAY_MINUTES = 24 * 60;
/** A booking with no end is an hour long, like everywhere else on the calendar. */
export const DEFAULT_LENGTH_MIN = 60;
/** Shortest a block is drawn (and counted for overlaps), so a 5-minute event can still be tapped. */
export const MIN_BLOCK_MIN = 20;
/** A tap on an empty slot books on this grid. */
export const SLOT_MIN = 30;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The device's yyyy-mm-dd for an instant. */
export function localDay(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

function clockMin(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

export type DaySpan = { startMin: number; endMin: number };

/**
 * The part of `day` (yyyy-mm-dd, device calendar) a booking covers, in minutes
 * after midnight: clipped to the day, so one past midnight shows on both days.
 * Null when it isn't on that day or its start can't be read. No end, or an end
 * that isn't after the start, is the default length.
 */
export function spanOnDay(day: string, startsAt: string, endsAt?: string | null): DaySpan | null {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  let end = endsAt ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + DEFAULT_LENGTH_MIN * 60_000);
  }
  const sDay = localDay(start);
  const eDay = localDay(end);
  if (sDay > day) return null;
  // Ends at or before this day's midnight: not on it (an end exactly at midnight belongs to the day before).
  if (eDay < day || (eDay === day && clockMin(end) === 0 && sDay < day)) return null;
  const startMin = sDay < day ? 0 : clockMin(start);
  const endMin = eDay > day ? DAY_MINUTES : clockMin(end);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

export type Placed<T> = {
  item: T;
  startMin: number;
  endMin: number;
  /** Column it sits in, of `cols` that its group of overlapping bookings shares. */
  col: number;
  cols: number;
  /** How many columns it spreads over (into free columns to its right). */
  span: number;
};

const overlap = (a: DaySpan, b: DaySpan) => a.startMin < b.endMin && b.startMin < a.endMin;

/**
 * Side by side, Google's way: bookings that overlap share the width in
 * columns (earliest first, the longer of two that start together first), each
 * in the first column free at its start; one with free columns to its right
 * spreads into them. Back-to-back bookings (10–11, 11–12) don't overlap.
 */
export function layoutDay<T>(entries: Array<{ item: T } & DaySpan>): Placed<T>[] {
  const sorted = entries
    .map((e) => ({ ...e, visEnd: Math.max(e.endMin, e.startMin + MIN_BLOCK_MIN) }))
    .sort((a, b) => a.startMin - b.startMin || b.visEnd - a.visEnd);
  const out: Placed<T>[] = [];
  let group: Array<(typeof sorted)[number] & { col: number }> = [];
  let groupEnd = -1;

  const flush = () => {
    if (!group.length) return;
    const cols = Math.max(...group.map((g) => g.col)) + 1;
    for (const g of group) {
      let span = 1;
      for (let c = g.col + 1; c < cols; c++) {
        const blocked = group.some((o) => o !== g && o.col === c && overlap({ startMin: g.startMin, endMin: g.visEnd }, { startMin: o.startMin, endMin: o.visEnd }));
        if (blocked) break;
        span++;
      }
      out.push({ item: g.item, startMin: g.startMin, endMin: g.endMin, col: g.col, cols, span });
    }
    group = [];
    groupEnd = -1;
  };

  for (const e of sorted) {
    if (group.length && e.startMin >= groupEnd) flush();
    const colEnds: number[] = [];
    for (const g of group) colEnds[g.col] = Math.max(colEnds[g.col] ?? -1, g.visEnd);
    let col = colEnds.findIndex((end) => end <= e.startMin);
    if (col === -1) col = colEnds.length;
    group.push({ ...e, col });
    groupEnd = Math.max(groupEnd, e.visEnd);
  }
  flush();
  return out;
}

/**
 * Where the grid opens, in minutes after midnight (the top of the view). When
 * everything on screen (and now, with today on screen) fits in the window, it
 * opens half an hour before the first of it, so the whole busy part shows at
 * once. Otherwise: an hour and a half before now with today on screen, else
 * half an hour before the first booking, else 7 AM. On a half hour, never so
 * late the day runs out under it.
 */
export function openingMinute(opts: { nowMin?: number | null; firstStartMin?: number | null; lastEndMin?: number | null; viewMin?: number }): number {
  const viewMin = opts.viewMin ?? 8 * 60;
  const { nowMin = null, firstStartMin = null, lastEndMin = null } = opts;
  let raw: number;
  const from = [firstStartMin, nowMin].filter((n): n is number => n != null);
  const to = [lastEndMin, nowMin].filter((n): n is number => n != null);
  if (firstStartMin != null && lastEndMin != null && Math.max(...to) - Math.min(...from) + 60 <= viewMin) raw = Math.min(...from) - 30;
  else if (nowMin != null) raw = nowMin - 90;
  else if (firstStartMin != null) raw = firstStartMin - 30;
  else raw = 7 * 60;
  const snapped = Math.floor(raw / SLOT_MIN) * SLOT_MIN;
  return Math.max(0, Math.min(snapped, DAY_MINUTES - viewMin));
}

/** "HH:MM" a tap at this minute books: the slot it falls in. */
export function slotTime(min: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES - SLOT_MIN, Math.floor(min / SLOT_MIN) * SLOT_MIN));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "6 AM", "12 PM", "9 PM": the grid's hour labels. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** "10 AM", "10:30 AM", or "10–11 AM" / "11:30 AM–12:30 PM" for a block. */
export function minuteClock(min: number, withSuffix = true): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${pad2(m)}` : ""}${withSuffix ? (h >= 12 ? " PM" : " AM") : ""}`;
}

/**
 * The Calendar page's view until the coach picks one: the week's timeline on a
 * computer, the day's on a phone (seven columns need the room), like Google.
 */
export function defaultTimelineView(width: number | null = typeof window === "undefined" ? null : window.innerWidth): "day" | "week" {
  return width != null && width < 640 ? "day" : "week";
}

const FAMILY_RANK: Record<string, number> = { people: 0, coach: 1, training: 2, google: 3 };

const STRUCK_STATUS = new Set(["cancelled", "canceled", "missed", "no_show", "no-show", "rescheduled"]);
const struck = (x: { status?: string | null }) => STRUCK_STATUS.has(String(x.status ?? "").toLowerCase());

/**
 * A month day with more than fits: what's still on first, then what was
 * cancelled or missed (shown crossed out, never pushing a live booking into
 * "+2"); within each, who's booked first (sessions, then the coach's own
 * events, training, then Google), each in time order, so a busy Google day
 * never pushes a session into "+2".
 */
export function monthChipOrder<T extends { family: string; startsAt?: string | null; status?: string | null }>(a: T, b: T): number {
  const s = Number(struck(a)) - Number(struck(b));
  if (s) return s;
  const r = (FAMILY_RANK[a.family] ?? 9) - (FAMILY_RANK[b.family] ?? 9);
  if (r) return r;
  const t = (x: T) => (x.startsAt ? Date.parse(x.startsAt) : -Infinity);
  return t(a) - t(b);
}
