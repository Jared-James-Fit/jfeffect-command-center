/**
 * Online booking: which start times a booking type offers. Pure, browser and
 * server safe, no I/O. The server feeds in everything that's busy (sessions,
 * appointments, events, Google) and this decides what's open.
 *
 * Times are worked out in the booking type's own zone (the coach's), so "6–9 AM
 * on Mondays" means 6–9 AM in Selkirk whatever zone the person booking is in.
 */
import { addDaysISO, localDateISO, overlaps, wallTimeToUtc } from "@/lib/schedule-time";

export type HoursWindow = { day_of_week: number; start_time: string; end_time: string };

export type BookingRules = {
  durationMin: number;
  timezone: string;
  minNoticeHours: number;
  maxAdvanceDays: number;
  bufferMin: number;
  maxPerDay: number | null;
};

export type BusyInterval = { start: number; end: number };

/** start / end are ISO instants; date is the day in the booking type's zone. */
export type Slot = { start: string; end: string; date: string };

export function hmToMin(hm: string): number {
  const [h, m] = String(hm).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToHm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * How far apart offered start times are. Short calls every 15 minutes, anything
 * longer every half hour: enough choice to fit around other things without a
 * wall of odd times like 9:20 and 9:40.
 */
export function slotStepMinutes(durationMin: number): number {
  return durationMin <= 20 ? 15 : 30;
}

/** Sorted, valid, overlap-merged windows per weekday. */
export function normalizeHours(hours: HoursWindow[]): HoursWindow[] {
  const out: HoursWindow[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const day = hours
      .filter((h) => h.day_of_week === dow)
      .map((h) => ({ s: hmToMin(h.start_time), e: hmToMin(h.end_time) }))
      .filter((w) => w.e > w.s)
      .sort((a, b) => a.s - b.s);
    const merged: Array<{ s: number; e: number }> = [];
    for (const w of day) {
      const last = merged[merged.length - 1];
      if (last && w.s <= last.e) last.e = Math.max(last.e, w.e);
      else merged.push({ ...w });
    }
    for (const w of merged)
      out.push({ day_of_week: dow, start_time: minToHm(w.s), end_time: minToHm(w.e) });
  }
  return out;
}

/** Day of week (0 = Sunday) of a yyyy-mm-dd date. */
export function dowOf(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

/** First and last bookable day (inclusive) in the type's zone. */
export function bookableDays(
  rules: Pick<BookingRules, "timezone" | "maxAdvanceDays">,
  now: Date,
): { first: string; last: string } {
  const first = localDateISO(now, rules.timezone);
  return { first, last: addDaysISO(first, rules.maxAdvanceDays) };
}

export function computeSlots(opts: {
  hours: HoursWindow[];
  rules: BookingRules;
  busy: BusyInterval[];
  /** Bookings of this type already on each day (type's zone), for "max per day". */
  bookedPerDay?: Record<string, number>;
  /** yyyy-mm-dd, inclusive, in the type's zone. */
  from: string;
  to: string;
  now: Date;
}): Slot[] {
  const { rules, busy, now } = opts;
  const dur = Math.max(5, Math.round(rules.durationMin));
  const step = slotStepMinutes(dur);
  const bufferMs = Math.max(0, rules.bufferMin) * 60_000;
  const earliest = now.getTime() + Math.max(0, rules.minNoticeHours) * 3_600_000;
  const { first, last } = bookableDays(rules, now);
  const from = opts.from > first ? opts.from : first;
  const to = opts.to < last ? opts.to : last;
  const hours = normalizeHours(opts.hours);

  const out: Slot[] = [];
  for (let date = from; date <= to; date = addDaysISO(date, 1)) {
    if (rules.maxPerDay && (opts.bookedPerDay?.[date] ?? 0) >= rules.maxPerDay) continue;
    const dow = dowOf(date);
    for (const w of hours) {
      if (w.day_of_week !== dow) continue;
      const end = hmToMin(w.end_time);
      for (let t = hmToMin(w.start_time); t + dur <= end; t += step) {
        const startMs = wallTimeToUtc(date, minToHm(t), rules.timezone).getTime();
        const endMs = startMs + dur * 60_000;
        if (startMs < earliest) continue;
        const held = { start: startMs - bufferMs, end: endMs + bufferMs };
        if (busy.some((b) => overlaps(held, b))) continue;
        out.push({
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          date,
        });
      }
    }
  }
  return out;
}

/** True when `startISO` is one of the open times right now (the booking re-check). */
export function isOpenSlot(slots: Slot[], startISO: string): Slot | null {
  const t = Date.parse(startISO);
  if (Number.isNaN(t)) return null;
  return slots.find((s) => Date.parse(s.start) === t) ?? null;
}

// ── Labels ────────────────────────────────────────────────────────────────────

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Weeks read Monday first. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "6 AM", "6:30 AM", "12 PM" */
function clock12(min: number, withSuffix = true): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${withSuffix ? ` ${suffix}` : ""}`;
}

/** "6–9 AM", "9 AM–5 PM" */
export function rangeLabel(startHM: string, endHM: string): string {
  const s = hmToMin(startHM);
  const e = hmToMin(endHM);
  const sameHalf = s < 720 === e < 720 && e !== 1440;
  return sameHalf ? `${clock12(s, false)}–${clock12(e)}` : `${clock12(s)}–${clock12(e)}`;
}

function dayGroupLabel(days: number[]): string {
  const idx = days.map((d) => WEEK_ORDER.indexOf(d)).sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const i of idx) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i);
    else runs.push([i]);
  }
  return runs
    .map((r) =>
      r.length >= 3
        ? `${DAY_SHORT[WEEK_ORDER[r[0]]]}–${DAY_SHORT[WEEK_ORDER[r[r.length - 1]]]}`
        : r.map((i) => DAY_SHORT[WEEK_ORDER[i]]).join(", "),
    )
    .join(", ");
}

/** "Mon–Fri 6–9 AM, 4–8 PM · Sat 8 AM–12 PM" (days with the same hours grouped). */
export function summarizeHours(hours: HoursWindow[]): string {
  const norm = normalizeHours(hours);
  if (!norm.length) return "No hours set";
  const byDay = new Map<number, string>();
  for (const d of WEEK_ORDER) {
    const label = norm
      .filter((w) => w.day_of_week === d)
      .map((w) => rangeLabel(w.start_time, w.end_time))
      .join(", ");
    if (label) byDay.set(d, label);
  }
  const groups = new Map<string, number[]>();
  for (const [d, label] of byDay) {
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(d);
  }
  return Array.from(groups.entries())
    .map(([label, days]) => `${dayGroupLabel(days)} ${label}`)
    .join(" · ");
}

/** URL-safe slug: "1:1 Training" → "1-1-training". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "book"
  );
}

export const HOURS_PRESETS: Array<{ id: string; label: string; hours: HoursWindow[] }> = [
  {
    id: "weekdays",
    label: "Weekdays 9–5",
    hours: [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: "09:00", end_time: "17:00" })),
  },
  {
    id: "trainer",
    label: "Mornings + evenings",
    hours: [
      ...[1, 2, 3, 4, 5].flatMap((d) => [
        { day_of_week: d, start_time: "06:00", end_time: "09:00" },
        { day_of_week: d, start_time: "16:00", end_time: "20:00" },
      ]),
      { day_of_week: 6, start_time: "08:00", end_time: "12:00" },
    ],
  },
  {
    id: "evenings",
    label: "Weeknights 6–8",
    hours: [1, 2, 3, 4].map((d) => ({ day_of_week: d, start_time: "18:00", end_time: "20:00" })),
  },
];
