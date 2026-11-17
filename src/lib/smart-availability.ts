/**
 * Smart availability: which call times to offer, worked out from the coach's
 * real schedule and the boundaries he sets. Pure, no I/O: the booking server
 * feeds in what's busy (sessions, appointments, events, Google free/busy) and
 * this decides what's open, with one short reason per day.
 *
 * Two layers, always in this order:
 *   1. Hard rules, never broken in any mode: inside his boundaries (days and
 *      hours, or a call type's own hours in Manual), outside protected time,
 *      away dates and blocked times, clear of anything busy by the gap, after
 *      the minimum notice and inside the booking window, under the daily and
 *      weekly call limits. An explicit "open" for a date is his decision and
 *      can reach outside the boundaries and protected time, never over
 *      anything busy.
 *   2. Smart picks (Automatic, or an Assisted day he accepted): of what the
 *      hard rules leave, offer the time that costs him least. A short gap
 *      between commitments is offered whole (it's too short to do deep work
 *      in anyway); a long open stretch gives up one block of call time at the
 *      edge next to something already on (calls grouped, context kept), and
 *      the rest stays clear for focused work; a busy day offers one window at
 *      most; and if the week would offer fewer call times than his floor, the
 *      next best time is opened until it doesn't.
 *
 * Deterministic: the same calendar and settings give the same answer, so the
 * preview the coach sees is what people can book. Times are worked out in
 * the coach's zone (`timezone`) through wallTimeToUtc, so clock changes are
 * handled by the zone's own rules.
 */
import { addDaysISO, localDateISO, localTimeHM, wallTimeToUtc } from "@/lib/schedule-time";
import { dowOf, hmToMin, minToHm, normalizeHours, rangeLabel, slotStepMinutes, type HoursWindow, type Slot } from "@/lib/booking-slots";

// ── Settings ──────────────────────────────────────────────────────────────────

export type AvailabilityMode = "manual" | "assisted" | "auto";
export type ProtectedKind = "training" | "personal" | "focus";

/** Every week, these hours on these days are never offered (0 = Sunday). */
export type ProtectedBlock = { id: string; label: string; kind: ProtectedKind; days: number[]; start: string; end: string };
/** Always offered in Automatic (still only when free and under the limits). */
export type PinnedWindow = { id: string; days: number[]; start: string; end: string };
/** Whole days off, inclusive. */
export type AwayRange = { id: string; from: string; to: string; label?: string | null };

export type AvailabilitySettings = {
  mode: AvailabilityMode;
  timezone: string;
  /** Days calls can be on (0 = Sunday). */
  days: number[];
  /** Earliest and latest a call can be, "HH:MM". */
  dayStart: string;
  dayEnd: string;
  maxPerDay: number | null;
  maxPerWeek: number | null;
  /** Clear time kept before and after every call. */
  gapMin: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  /** Off: nothing inside 24 hours, whatever the notice says. */
  lastMinute: boolean;
  protected: ProtectedBlock[];
  pinned: PinnedWindow[];
  away: AwayRange[];
  /** The shortest stretch worth keeping clear for focused work. */
  focusMin: number;
  /** How much call time a long open stretch gives up at once. */
  callBlockMin: number;
  /** Where calls go first when there's a choice ("HH:MM"), else null. */
  preferredStart: string | null;
  preferredEnd: string | null;
  /** Keep at least this many call times open a week (0 = no floor). */
  weeklyFloor: number;
  /** Open more time when a week is filling up. */
  stretch: boolean;
  /** Manual until this day (inclusive), whatever the mode. */
  pausedUntil: string | null;
  /** What he changed by hand before this isn't learned from. */
  learningSince: string | null;
  /** Suggestions he said no to. */
  dismissed: string[];
  /** When he confirmed his boundaries (Automatic needs it). */
  confirmedAt: string | null;
  /** More Google calendars whose busy time blocks bookings (the app's calendar and his main one always do). */
  extraCalendars: string[];
};

export const DEFAULT_AVAILABILITY: AvailabilitySettings = {
  mode: "manual",
  timezone: "America/Winnipeg",
  days: [1, 2, 3, 4, 5],
  dayStart: "09:00",
  dayEnd: "17:00",
  maxPerDay: 3,
  maxPerWeek: 10,
  gapMin: 15,
  minNoticeHours: 12,
  maxAdvanceDays: 30,
  lastMinute: true,
  protected: [],
  pinned: [],
  away: [],
  focusMin: 120,
  callBlockMin: 120,
  preferredStart: null,
  preferredEnd: null,
  weeklyFloor: 4,
  stretch: true,
  pausedUntil: null,
  learningSince: null,
  dismissed: [],
  confirmedAt: null,
  extraCalendars: [],
};

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const hm = (v: unknown, fallback: string) => (typeof v === "string" && HM.test(v.slice(0, 5)) ? v.slice(0, 5) : fallback);
const hmOrNull = (v: unknown) => (typeof v === "string" && HM.test(v.slice(0, 5)) ? v.slice(0, 5) : null);
const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};
const intOrNull = (v: unknown, lo: number, hi: number) => (v == null || v === "" ? null : int(v, lo, hi, lo));
const dayList = (v: unknown, fallback: number[]) =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : fallback;
const id = (v: unknown, i: number) => (typeof v === "string" && v ? v.slice(0, 64) : `item-${i}`);

/** Only values the engine understands; anything else falls back to the defaults. */
export function sanitizeAvailability(raw: unknown): AvailabilitySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const d = DEFAULT_AVAILABILITY;
  const mode: AvailabilityMode = r.mode === "assisted" || r.mode === "auto" ? r.mode : "manual";
  const dayStart = hm(r.dayStart, d.dayStart);
  let dayEnd = hm(r.dayEnd, d.dayEnd);
  if (hmToMin(dayEnd) <= hmToMin(dayStart)) dayEnd = minToHm(Math.min(1439, hmToMin(dayStart) + 60));
  const window = (w: any, i: number) => {
    const start = hmOrNull(w?.start);
    const end = hmOrNull(w?.end);
    if (!start || !end || hmToMin(end) <= hmToMin(start)) return null;
    return { id: id(w?.id, i), days: dayList(w?.days, []), start, end };
  };
  const protectedBlocks: ProtectedBlock[] = (Array.isArray(r.protected) ? r.protected : [])
    .map((w: any, i: number) => {
      const base = window(w, i);
      if (!base || !base.days.length) return null;
      const kind: ProtectedKind = w.kind === "training" || w.kind === "personal" ? w.kind : "focus";
      return { ...base, kind, label: String(w.label ?? "").trim().slice(0, 60) || PROTECTED_LABEL[kind] };
    })
    .filter(Boolean)
    .slice(0, 30) as ProtectedBlock[];
  const pinned: PinnedWindow[] = (Array.isArray(r.pinned) ? r.pinned : [])
    .map(window)
    .filter((w: PinnedWindow | null): w is PinnedWindow => !!w && w.days.length > 0)
    .slice(0, 20);
  const away: AwayRange[] = (Array.isArray(r.away) ? r.away : [])
    .map((a: any, i: number) => {
      const from = typeof a?.from === "string" && DATE.test(a.from) ? a.from : null;
      const to = typeof a?.to === "string" && DATE.test(a.to) ? a.to : from;
      if (!from || !to) return null;
      return { id: id(a?.id, i), from: from <= to ? from : to, to: from <= to ? to : from, label: a?.label ? String(a.label).slice(0, 60) : null };
    })
    .filter(Boolean)
    .slice(0, 50) as AwayRange[];
  const preferredStart = hmOrNull(r.preferredStart);
  const preferredEnd = hmOrNull(r.preferredEnd);
  const preferredOk = !!preferredStart && !!preferredEnd && hmToMin(preferredEnd) > hmToMin(preferredStart);
  return {
    mode,
    timezone: typeof r.timezone === "string" && r.timezone ? r.timezone : d.timezone,
    days: dayList(r.days, d.days),
    dayStart,
    dayEnd,
    maxPerDay: r.maxPerDay === undefined ? d.maxPerDay : intOrNull(r.maxPerDay, 1, 20),
    maxPerWeek: r.maxPerWeek === undefined ? d.maxPerWeek : intOrNull(r.maxPerWeek, 1, 80),
    gapMin: int(r.gapMin, 0, 120, d.gapMin),
    minNoticeHours: int(r.minNoticeHours, 0, 24 * 14, d.minNoticeHours),
    maxAdvanceDays: int(r.maxAdvanceDays, 1, 180, d.maxAdvanceDays),
    lastMinute: typeof r.lastMinute === "boolean" ? r.lastMinute : d.lastMinute,
    protected: protectedBlocks,
    pinned,
    away,
    focusMin: int(r.focusMin, 30, 480, d.focusMin),
    callBlockMin: int(r.callBlockMin, 30, 480, d.callBlockMin),
    preferredStart: preferredOk ? preferredStart : null,
    preferredEnd: preferredOk ? preferredEnd : null,
    weeklyFloor: int(r.weeklyFloor, 0, 60, d.weeklyFloor),
    stretch: typeof r.stretch === "boolean" ? r.stretch : d.stretch,
    pausedUntil: typeof r.pausedUntil === "string" && DATE.test(r.pausedUntil) ? r.pausedUntil : null,
    learningSince: typeof r.learningSince === "string" && !Number.isNaN(Date.parse(r.learningSince)) ? r.learningSince : null,
    dismissed: Array.isArray(r.dismissed) ? r.dismissed.filter((x: unknown) => typeof x === "string").slice(0, 200) : [],
    confirmedAt: typeof r.confirmedAt === "string" && !Number.isNaN(Date.parse(r.confirmedAt)) ? r.confirmedAt : null,
    extraCalendars: Array.isArray(r.extraCalendars)
      ? [...new Set(r.extraCalendars.filter((x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 300))].slice(0, 10)
      : [],
  };
}

export const PROTECTED_LABEL: Record<ProtectedKind, string> = {
  training: "Training",
  personal: "Personal",
  focus: "Focus time",
};

// ── Day changes ───────────────────────────────────────────────────────────────

/**
 * A change for one date: block some time, open extra time, take the day
 * off, or (Assisted) use the smart picks that day.
 */
export type OverrideKind = "block" | "open" | "off" | "smart";
export type AvailabilityOverride = {
  id?: string;
  date: string;
  kind: OverrideKind;
  start?: string | null;
  end?: string | null;
  note?: string | null;
  created_at?: string | null;
};

// ── Inputs ────────────────────────────────────────────────────────────────────

export type BusyKind = "session" | "appointment" | "event" | "google" | "call";
/** Busy time as instants. Only times, never titles: the engine needs nothing else. */
export type BusyItem = { start: number; end: number; kind: BusyKind };

export type CallType = {
  durationMin: number;
  /** The type's own buffer, notice and window (the stricter of these and the settings wins). */
  bufferMin: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  maxPerDay: number | null;
  /** Its own weekly hours: what Manual offers (empty = the settings' boundaries). */
  hours: HoursWindow[];
};

export type PlanInput = {
  settings: AvailabilitySettings;
  overrides: AvailabilityOverride[];
  type: CallType;
  busy: BusyItem[];
  /** Calls already booked (counted for the limits; also in `busy`). */
  calls: Array<{ start: number; end: number }>;
  /** Calls of this type per day (its own daily limit). */
  typeCallsPerDay?: Record<string, number>;
  from: string;
  to: string;
  now: Date;
};

// ── Output ────────────────────────────────────────────────────────────────────

export type Range = { start: number; end: number };
export type DayMode = "manual" | "smart";
export type DayPlan = {
  date: string;
  /** The day's local midnight (start times sit on the quarter / half hours from it). */
  midnight: number;
  /** How this day was decided. */
  how: DayMode;
  /** What the hard rules leave free (gap included). */
  free: Range[];
  /** What's offered: windows people can book inside. */
  windows: Range[];
  /** Assisted: what the smart picks would offer (shown, not live). */
  suggested: Range[] | null;
  slots: Slot[];
  /** One short reason, when there's something worth saying. */
  reason: string | null;
  /** Protected time on this day (for the preview). */
  protectedTimes: Array<Range & { label: string; kind: ProtectedKind }>;
  callsBooked: number;
  closed: boolean;
};

export type AvailabilityPlan = {
  days: DayPlan[];
  slots: Slot[];
};

// ── Small helpers ─────────────────────────────────────────────────────────────

const MIN = 60_000;

function mondayOf(date: string): string {
  return addDaysISO(date, -((dowOf(date) + 6) % 7));
}

/** Free time = `base` minus every range in `cut`, keeping what bounded each piece. */
type Piece = Range & { startEdge: Edge; endEdge: Edge };
type Edge = "window" | "busy" | "protected" | "notice" | "block";

function subtract(base: Piece[], cut: Array<Range & { edge: Edge }>): Piece[] {
  let out = base;
  for (const c of cut) {
    const next: Piece[] = [];
    for (const p of out) {
      if (c.end <= p.start || c.start >= p.end) {
        next.push(p);
        continue;
      }
      if (c.start > p.start) next.push({ start: p.start, end: c.start, startEdge: p.startEdge, endEdge: c.edge });
      if (c.end < p.end) next.push({ start: c.end, end: p.end, startEdge: c.edge, endEdge: p.endEdge });
    }
    out = next;
  }
  return out.filter((p) => p.end > p.start);
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function overlapMs(a: Range, b: Range): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function wall(date: string, hmStr: string, tz: string): number {
  // "24:00" (end of day) is the next midnight.
  if (hmStr === "24:00") return wallTimeToUtc(addDaysISO(date, 1), "00:00", tz).getTime();
  return wallTimeToUtc(date, hmStr, tz).getTime();
}

function windowsFor(date: string, list: Array<{ start: string; end: string }>, tz: string): Range[] {
  return list.map((w) => ({ start: wall(date, w.start, tz), end: wall(date, w.end, tz) })).filter((r) => r.end > r.start);
}

/** Start times inside `ranges`, on the wall clock's quarter / half hours. */
function startsIn(ranges: Range[], durMs: number, stepMs: number, dayMidnight: number): number[] {
  const out: number[] = [];
  for (const r of ranges) {
    let t = dayMidnight + Math.ceil((r.start - dayMidnight) / stepMs) * stepMs;
    for (; t + durMs <= r.end; t += stepMs) out.push(t);
  }
  return out;
}

function clock(ms: number, tz: string): string {
  return localTimeHM(new Date(ms), tz);
}

function rangeText(r: Range, tz: string): string {
  return rangeLabel(clock(r.start, tz), clock(r.end, tz) === "00:00" ? "24:00" : clock(r.end, tz));
}

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── The plan ──────────────────────────────────────────────────────────────────

/** Which mode decides a date: paused → Manual; Assisted days he accepted → smart. */
export function dayModeFor(date: string, settings: AvailabilitySettings, overrides: AvailabilityOverride[]): DayMode {
  if (settings.pausedUntil && date <= settings.pausedUntil) return "manual";
  if (settings.mode === "auto") return "smart";
  if (settings.mode === "assisted" && overrides.some((o) => o.date === date && o.kind === "smart")) return "smart";
  return "manual";
}

/** A day is "busy" when this much is already on: it offers one window at most. */
const BUSY_DAY_ITEMS = 4;
const BUSY_DAY_SHARE = 0.6;

type Grid = { midnight: number; stepMs: number };

type DayWork = {
  date: string;
  how: DayMode;
  midnight: number;
  boundary: Range[];
  free: Piece[];
  hardFree: Range[];
  pinned: Range[];
  preferred: Range | null;
  protectedTimes: DayPlan["protectedTimes"];
  load: number;
  busyShare: number;
  callsBooked: number;
  closedReason: string | null;
  windows: Range[];
  suggested: Range[] | null;
  reason: string | null;
  expanded: boolean;
};

export function planAvailability(input: PlanInput): AvailabilityPlan {
  const { settings: s, overrides, type, now } = input;
  const tz = s.timezone;
  const durMs = Math.max(5, Math.round(type.durationMin)) * MIN;
  const stepMs = slotStepMinutes(type.durationMin) * MIN;
  const gapMs = Math.max(s.gapMin, type.bufferMin) * MIN;
  const noticeH = Math.max(s.minNoticeHours, type.minNoticeHours, s.lastMinute ? 0 : 24);
  const earliest = now.getTime() + noticeH * 3_600_000;
  const advance = Math.min(s.maxAdvanceDays, type.maxAdvanceDays);
  const today = localDateISO(now, tz);
  const lastDay = addDaysISO(today, advance);
  const from = input.from > today ? input.from : today;
  const to = input.to < lastDay ? input.to : lastDay;
  const ownHours = normalizeHours(type.hours ?? []);

  // Calls already booked, per day and per week (Monday start), in his zone.
  const callsPerDay: Record<string, number> = {};
  const callsPerWeek: Record<string, number> = {};
  for (const c of input.calls) {
    const d = localDateISO(new Date(c.start), tz);
    callsPerDay[d] = (callsPerDay[d] ?? 0) + 1;
    const w = mondayOf(d);
    callsPerWeek[w] = (callsPerWeek[w] ?? 0) + 1;
  }
  const busy = input.busy.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);

  const work: DayWork[] = [];
  for (let date = from; date <= to; date = addDaysISO(date, 1)) {
    const dow = dowOf(date);
    const how = dayModeFor(date, s, overrides);
    const midnight = wall(date, "00:00", tz);
    const dayOverrides = overrides.filter((o) => o.date === date);
    const opens = windowsFor(
      date,
      dayOverrides.filter((o) => o.kind === "open" && o.start && o.end).map((o) => ({ start: o.start!, end: o.end! })),
      tz,
    );
    const away = s.away.find((a) => a.from <= date && date <= a.to);
    const off = dayOverrides.some((o) => o.kind === "off");

    // The day's outer boundary: his days and hours (smart), a type's own hours (Manual), plus any time he opened.
    let boundary: Range[] = [];
    if (!away && !off) {
      if (how === "manual" && ownHours.length) {
        boundary = windowsFor(date, ownHours.filter((h) => h.day_of_week === dow).map((h) => ({ start: h.start_time, end: h.end_time })), tz);
      } else if (s.days.includes(dow)) {
        boundary = windowsFor(date, [{ start: s.dayStart, end: s.dayEnd }], tz);
      }
    }
    const protectedTimes = s.protected
      .filter((p) => p.days.includes(dow))
      .map((p) => ({ ...windowsFor(date, [p], tz)[0], label: p.label, kind: p.kind }))
      .filter((p) => p.start !== undefined && p.end > p.start);

    // Hard rules. Protected and blocked time come off the boundary; time he opened comes back
    // on top (his explicit call for that date), and then busy time, notice and the window come off everything.
    const busyCuts = busy.map((b) => ({ start: b.start - gapMs, end: b.end + gapMs, edge: "busy" as Edge }));
    const blockCuts = windowsFor(
      date,
      dayOverrides.filter((o) => o.kind === "block" && o.start && o.end).map((o) => ({ start: o.start!, end: o.end! })),
      tz,
    ).map((r) => ({ ...r, edge: "block" as Edge }));
    let pieces: Piece[] = boundary.map((r) => ({ ...r, startEdge: "window", endEdge: "window" }));
    pieces = subtract(pieces, protectedTimes.map((p) => ({ start: p.start, end: p.end, edge: "protected" as Edge })));
    const merged = mergeRanges([...pieces, ...opens]);
    pieces = merged.map((r) => {
      const known = pieces.find((p) => p.start === r.start && p.end === r.end);
      return known ?? { ...r, startEdge: "window" as Edge, endEdge: "window" as Edge };
    });
    pieces = subtract(pieces, blockCuts);
    pieces = subtract(pieces, busyCuts);
    if (earliest > midnight) pieces = subtract(pieces, [{ start: midnight - 1, end: earliest, edge: "notice" }]);
    const free = pieces.filter((p) => p.end - p.start >= durMs);
    const hardFree = free.map(({ start, end }) => ({ start, end }));

    // How full the day already is, inside his boundary.
    const bound = boundary.length ? { start: Math.min(...boundary.map((b) => b.start)), end: Math.max(...boundary.map((b) => b.end)) } : null;
    const dayBusy = bound ? mergeRanges(busy.filter((b) => overlapMs(b, bound) > 0).map((b) => ({ start: Math.max(b.start, bound.start), end: Math.min(b.end, bound.end) }))) : [];
    const load = dayBusy.length;
    const busyShare = bound ? dayBusy.reduce((t, b) => t + (b.end - b.start), 0) / Math.max(1, bound.end - bound.start) : 0;

    const callsBooked = callsPerDay[date] ?? 0;
    const week = mondayOf(date);
    let closedReason: string | null = null;
    if (away) closedReason = `Away${away.label ? `: ${away.label}` : ""}`;
    else if (off) closedReason = "Day off";
    else if (!boundary.length && !opens.length)
      closedReason = how === "manual" && ownHours.length ? null : `No calls on ${DAY_NAME[dow]}s`;
    else if (s.maxPerDay && callsBooked >= s.maxPerDay) closedReason = `${callsBooked} call${callsBooked === 1 ? "" : "s"} already, your daily limit`;
    else if (type.maxPerDay && (input.typeCallsPerDay?.[date] ?? 0) >= type.maxPerDay) closedReason = "This type's daily limit is reached";
    else if (s.maxPerWeek && (callsPerWeek[week] ?? 0) >= s.maxPerWeek) closedReason = "Your weekly call limit is reached";

    const pinned = how === "smart" ? windowsFor(date, s.pinned.filter((p) => p.days.includes(dow)), tz) : [];
    const preferred =
      s.preferredStart && s.preferredEnd ? { start: wall(date, s.preferredStart, tz), end: wall(date, s.preferredEnd, tz) } : null;

    work.push({
      date,
      how,
      midnight,
      boundary,
      free,
      hardFree,
      pinned,
      preferred,
      protectedTimes,
      load,
      busyShare,
      callsBooked,
      closedReason,
      windows: [],
      suggested: null,
      reason: null,
      expanded: false,
    });
  }

  // Each day on its own first.
  for (const d of work) {
    if (d.closedReason) {
      d.reason = d.closedReason;
      continue;
    }
    if (!d.hardFree.length) {
      d.reason = d.boundary.length ? "Nothing free inside your hours" : null;
      continue;
    }
    const smart = pickSmart(d, s, durMs, { midnight: d.midnight, stepMs });
    if (d.how === "smart") {
      d.windows = smart.windows;
      d.reason = smart.reason;
    } else {
      d.windows = d.hardFree;
      if (s.mode === "assisted") d.suggested = smart.windows;
      d.reason = d.protectedTimes.some((p) => d.boundary.some((b) => overlapMs(b, p) > 0))
        ? `${d.protectedTimes[0].label} protected`
        : null;
    }
  }

  // Then the week: keep the floor (and open more when it's filling up), smart days only.
  const weeks = new Map<string, DayWork[]>();
  for (const d of work) {
    const w = mondayOf(d.date);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w)!.push(d);
  }
  for (const [week, days] of weeks) {
    const smartDays = days.filter((d) => d.how === "smart" && !d.closedReason && d.hardFree.length);
    if (!smartDays.length) continue;
    const booked = callsPerWeek[week] ?? 0;
    let target = s.weeklyFloor;
    let why = `Opened more time to keep at least ${s.weeklyFloor} call times this week`;
    if (s.stretch && s.weeklyFloor > 0 && booked >= s.weeklyFloor) {
      target = s.weeklyFloor * 2;
      why = "This week is filling up, so more time is open";
    }
    if (target <= 0) continue;
    const count = () => smartDays.reduce((n, d) => n + startsIn(d.windows, durMs, stepMs, d.midnight).length, 0);
    let have = count();
    if (have >= target) continue;
    // What's left, best first: next to what's offered or already on, inside the preferred time, quieter days, sooner.
    const extras: Array<{ day: DayWork; r: Range; score: number }> = [];
    for (const d of smartDays) {
      const left = subtract(
        d.free,
        d.windows.map((w) => ({ ...w, edge: "busy" as Edge })),
      ).filter((p) => p.end - p.start >= durMs);
      for (const p of left) {
        const r = placeBlock(p, s, durMs, d.preferred, { midnight: d.midnight, stepMs });
        let score = 0;
        if (p.startEdge === "busy" || p.endEdge === "busy") score += 2;
        if (d.preferred && overlapMs(r, d.preferred) > 0) score += 1;
        score -= d.load * 0.25;
        score -= work.indexOf(d) * 0.01;
        extras.push({ day: d, r, score });
      }
    }
    extras.sort((a, b) => b.score - a.score);
    for (const e of extras) {
      if (have >= target) break;
      e.day.windows = mergeRanges([...e.day.windows, e.r]);
      e.day.expanded = true;
      have = count();
    }
    for (const d of smartDays) if (d.expanded) d.reason = why;
  }

  const days: DayPlan[] = work.map((d) => {
    const slots = startsIn(d.windows, durMs, stepMs, d.midnight).map((t) => ({
      start: new Date(t).toISOString(),
      end: new Date(t + durMs).toISOString(),
      date: d.date,
    }));
    return {
      date: d.date,
      midnight: d.midnight,
      how: d.how,
      free: d.hardFree,
      windows: d.windows,
      suggested: d.suggested,
      slots,
      reason: d.reason,
      protectedTimes: d.protectedTimes,
      callsBooked: d.callsBooked,
      closed: !!d.closedReason,
    };
  });
  return { days, slots: days.flatMap((d) => d.slots) };
}

/**
 * The smart pick for one day. A short gap is offered whole; a long stretch
 * gives up one call block next to what's already on (or in the preferred
 * time, or at its end) and keeps the rest clear; a busy day gets one window.
 */
function pickSmart(d: DayWork, s: AvailabilitySettings, durMs: number, grid: Grid): { windows: Range[]; reason: string | null } {
  const focusMs = s.focusMin * MIN;
  const tz = s.timezone;
  const busyDay = d.load >= BUSY_DAY_ITEMS || d.busyShare >= BUSY_DAY_SHARE;
  type Cand = { r: Range; score: number; nextToBusy: boolean; fragment: boolean; trimmed: boolean };
  const cands: Cand[] = [];
  for (const p of d.free) {
    const len = p.end - p.start;
    const nextToBusy = p.startEdge === "busy" || p.endEdge === "busy";
    if (len < focusMs) {
      // Too short to work in anyway: it costs nothing to take calls here.
      cands.push({ r: { start: p.start, end: p.end }, score: (nextToBusy ? 3 : 1) + preferredScore(p, d.preferred), nextToBusy, fragment: true, trimmed: false });
      continue;
    }
    const r = placeBlock(p, s, durMs, d.preferred, grid);
    // Trimmed: the block took only part of the stretch, so the rest stays clear.
    cands.push({ r, score: (nextToBusy ? 2 : 0) + preferredScore(r, d.preferred), nextToBusy, fragment: false, trimmed: r.end - r.start < len });
  }
  let chosen = cands;
  if (busyDay) {
    // Already full: one window, the one that disturbs least.
    chosen = [...cands].sort((a, b) => b.score - a.score || a.r.start - b.r.start).slice(0, 1);
  }
  const pinned = d.pinned.flatMap((pin) =>
    d.hardFree.map((f) => ({ start: Math.max(f.start, pin.start), end: Math.min(f.end, pin.end) })).filter((r) => r.end - r.start >= durMs),
  );
  const windows = mergeRanges([...chosen.map((c) => c.r), ...pinned]);

  let reason: string | null = null;
  if (busyDay) reason = `Busy day (${d.load} things on), so one window at most`;
  else if (chosen.some((c) => c.trimmed)) {
    const block = chosen.find((c) => c.trimmed)!;
    reason = block.nextToBusy
      ? `Calls ${rangeText(block.r, tz)}, next to what's on, so the rest stays clear`
      : `Calls grouped ${rangeText(block.r, tz)} to keep the rest of the day clear`;
  } else if (chosen.length && chosen.every((c) => c.fragment && c.nextToBusy)) reason = "Calls fill the gaps between what's on";
  const prot = d.protectedTimes.find((p) => d.boundary.some((b) => overlapMs(b, p) > 0));
  if (!reason && prot) reason = `${prot.label} protected`;
  return { windows, reason };
}

function preferredScore(r: Range, preferred: Range | null): number {
  return preferred && overlapMs(r, preferred) > 0 ? 1 : 0;
}

/**
 * One call block inside a long stretch: at the edge next to something
 * already on (the preferred time's side first), else inside the preferred
 * time, else at the stretch's end. What's left on the other side is only
 * kept clear when it's long enough to work in; a sliver goes to the block.
 */
function placeBlock(p: Piece, s: AvailabilitySettings, durMs: number, preferred: Range | null, grid: Grid): Range {
  const len = p.end - p.start;
  const blockMs = Math.max(s.callBlockMin * MIN, durMs);
  if (len <= blockMs) return { start: p.start, end: p.end };
  const focusMs = s.focusMin * MIN;
  const up = (t: number) => grid.midnight + Math.ceil((t - grid.midnight) / grid.stepMs) * grid.stepMs;
  const down = (t: number) => grid.midnight + Math.floor((t - grid.midnight) / grid.stepMs) * grid.stepMs;
  // Where the block goes, decided on the plain clock: next to something already on (the
  // preferred time's side first), else inside the preferred time, else at the stretch's end.
  let side: "start" | "end" | "preferred";
  const startBusy = p.startEdge === "busy";
  const endBusy = p.endEdge === "busy";
  if (startBusy && endBusy) {
    const atStart = { start: p.start, end: p.start + blockMs };
    const atEnd = { start: p.end - blockMs, end: p.end };
    side = preferred && overlapMs(atEnd, preferred) > overlapMs(atStart, preferred) ? "end" : "start";
  } else if (startBusy) side = "start";
  else if (endBusy) side = "end";
  else if (preferred && overlapMs(p, preferred) >= durMs) side = "preferred";
  else side = "end";
  const raw =
    side === "start"
      ? { start: p.start, end: p.start + blockMs }
      : side === "end"
        ? { start: p.end - blockMs, end: p.end }
        : { start: Math.max(p.start, preferred!.start), end: Math.min(p.end, Math.max(p.start, preferred!.start) + blockMs) };
  // A leftover too short to work in goes with the block (judged before rounding, so rounding
  // to the start-time grid never costs focus time).
  const absorbBefore = raw.start - p.start < focusMs;
  const absorbAfter = p.end - raw.end < focusMs;
  // Then on the grid: a block's worth of whole start times from its inner edge.
  let r: Range;
  if (side === "end") {
    const lastEnd = down(p.end - durMs) + durMs;
    r = { start: Math.max(p.start, up(lastEnd - blockMs)), end: p.end };
  } else {
    const first = up(raw.start);
    r = { start: raw.start, end: Math.min(p.end, first + blockMs) };
  }
  if (absorbBefore) r = { start: p.start, end: r.end };
  if (absorbAfter) r = { start: r.start, end: p.end };
  return r;
}

/** True when this exact start is bookable under the hard rules (the booking re-check). */
export function isHardOpen(plan: AvailabilityPlan, startISO: string, durMin: number): Slot | null {
  const t = Date.parse(startISO);
  if (Number.isNaN(t)) return null;
  const durMs = durMin * MIN;
  const stepMs = slotStepMinutes(durMin) * MIN;
  for (const d of plan.days) {
    if (d.closed || (t - d.midnight) % stepMs !== 0) continue;
    if (d.free.some((f) => f.start <= t && t + durMs <= f.end)) {
      return { start: new Date(t).toISOString(), end: new Date(t + durMs).toISOString(), date: d.date };
    }
  }
  return null;
}

/** Offered windows as wall-clock text, for the preview ("2–4 PM"). */
export function windowText(r: Range, tz: string): string {
  return rangeText(r, tz);
}

// ── Learning from his changes ─────────────────────────────────────────────────

export type LearnedSuggestion = {
  key: string;
  kind: "protect" | "pin" | "day_off";
  days: number[];
  start: string | null;
  end: string | null;
  weeks: number;
  text: string;
};

type Part = "morning" | "afternoon" | "evening";
function partOf(startHM: string): Part {
  const m = hmToMin(startHM);
  return m < 12 * 60 ? "morning" : m < 17 * 60 ? "afternoon" : "evening";
}

/** Look back this far for a habit. */
export const LEARN_WEEKS = 8;
/** A habit is the same change in this many different weeks. */
export const LEARN_MIN_WEEKS = 3;

/**
 * What his own changes say he wants every week: the same time blocked (or
 * opened) on the same weekday in 3+ different weeks out of the last 8, or the
 * same day taken off. Only ever a suggestion he accepts or dismisses; nothing
 * learned is applied by itself, and Reset starts the count over.
 */
export function learnFromOverrides(
  overrides: AvailabilityOverride[],
  settings: AvailabilitySettings,
  today: string,
): LearnedSuggestion[] {
  const since = addDaysISO(today, -LEARN_WEEKS * 7);
  const learningFrom = settings.learningSince ? settings.learningSince.slice(0, 10) : null;
  const recent = overrides.filter((o) => o.date >= since && o.date <= addDaysISO(today, 28) && (!learningFrom || (o.created_at ?? o.date).slice(0, 10) >= learningFrom));
  const groups = new Map<string, { kind: LearnedSuggestion["kind"]; dow: number; weeks: Set<string>; start: number; end: number }>();
  for (const o of recent) {
    const dow = dowOf(o.date);
    if (o.kind === "off") {
      const key = `day_off:${dow}`;
      const g = groups.get(key) ?? { kind: "day_off" as const, dow, weeks: new Set<string>(), start: 0, end: 0 };
      g.weeks.add(mondayOf(o.date));
      groups.set(key, g);
      continue;
    }
    if ((o.kind !== "block" && o.kind !== "open") || !o.start || !o.end) continue;
    const kind = o.kind === "block" ? "protect" : "pin";
    const key = `${kind}:${dow}:${partOf(o.start)}`;
    const g = groups.get(key) ?? { kind, dow, weeks: new Set<string>(), start: hmToMin(o.start), end: hmToMin(o.end) };
    g.weeks.add(mondayOf(o.date));
    g.start = Math.min(g.start, hmToMin(o.start));
    g.end = Math.max(g.end, hmToMin(o.end));
    groups.set(key, g);
  }
  const out: LearnedSuggestion[] = [];
  for (const [key, g] of groups) {
    if (g.weeks.size < LEARN_MIN_WEEKS || settings.dismissed.includes(key)) continue;
    const day = DAY_NAME[g.dow];
    if (g.kind === "day_off") {
      if (!settings.days.includes(g.dow)) continue;
      out.push({ key, kind: "day_off", days: [g.dow], start: null, end: null, weeks: g.weeks.size, text: `You've taken ${g.weeks.size} ${day}s off. No calls on ${day}s?` });
      continue;
    }
    const start = minToHm(g.start);
    const end = minToHm(g.end);
    if (g.kind === "protect") {
      const covered = settings.protected.some((p) => p.days.includes(g.dow) && hmToMin(p.start) <= g.start && hmToMin(p.end) >= g.end);
      if (covered) continue;
      out.push({ key, kind: "protect", days: [g.dow], start, end, weeks: g.weeks.size, text: `You've blocked ${day} ${rangeLabel(start, end)} in ${g.weeks.size} weeks. Protect it every week?` });
    } else {
      const covered = settings.pinned.some((p) => p.days.includes(g.dow) && hmToMin(p.start) <= g.start && hmToMin(p.end) >= g.end);
      if (covered) continue;
      out.push({ key, kind: "pin", days: [g.dow], start, end, weeks: g.weeks.size, text: `You've opened ${day} ${rangeLabel(start, end)} in ${g.weeks.size} weeks. Always offer it?` });
    }
  }
  return out.sort((a, b) => b.weeks - a.weeks);
}

// ── Reading his calendar for habits ───────────────────────────────────────────

export type RecurringBlock = { key: string; days: number[]; start: string; end: string; weeks: number; of: number; text: string };

/**
 * Times something on his calendar keeps happening (the same weekday and
 * time in at least half of the weeks looked at, and 3 or more), offered as
 * protected time to confirm. Reads only start and end times, never what an
 * event is. App sessions are left out: those are clients, already busy when booked.
 */
export function recurringBlocks(
  items: BusyItem[],
  settings: AvailabilitySettings,
  weeks: number,
): RecurringBlock[] {
  const tz = settings.timezone;
  const buckets = new Map<string, { dow: number; start: string; end: string; weeks: Set<string> }>();
  for (const b of items) {
    if (b.kind === "session" || b.kind === "call" || b.kind === "appointment") continue;
    const len = b.end - b.start;
    if (len < 30 * MIN || len > 6 * 60 * MIN) continue; // all-day things and blips aren't habits
    const date = localDateISO(new Date(b.start), tz);
    const round = (ms: number) => minToHm(Math.round(hmToMin(clock(ms, tz)) / 15) * 15 % 1440);
    const start = round(b.start);
    const end = round(b.end);
    if (hmToMin(end) <= hmToMin(start)) continue;
    const dow = dowOf(date);
    const key = `${dow}:${start}:${end}`;
    const g = buckets.get(key) ?? { dow, start, end, weeks: new Set<string>() };
    g.weeks.add(mondayOf(date));
    buckets.set(key, g);
  }
  const out: RecurringBlock[] = [];
  for (const [key, g] of buckets) {
    if (g.weeks.size < 3 || g.weeks.size < weeks / 2) continue;
    if (!settings.days.includes(g.dow)) continue;
    const covered = settings.protected.some((p) => p.days.includes(g.dow) && hmToMin(p.start) <= hmToMin(g.start) && hmToMin(p.end) >= hmToMin(g.end));
    if (covered || settings.dismissed.includes(`habit:${key}`)) continue;
    // Only habits that land inside his call hours matter here.
    if (hmToMin(g.end) <= hmToMin(settings.dayStart) || hmToMin(g.start) >= hmToMin(settings.dayEnd)) continue;
    out.push({
      key: `habit:${key}`,
      days: [g.dow],
      start: g.start,
      end: g.end,
      weeks: g.weeks.size,
      of: weeks,
      text: `${DAY_NAME[g.dow]} ${rangeLabel(g.start, g.end)}: something's on in ${g.weeks.size} of the last ${weeks} weeks`,
    });
  }
  return out.sort((a, b) => b.weeks - a.weeks || a.days[0] - b.days[0]).slice(0, 6);
}
