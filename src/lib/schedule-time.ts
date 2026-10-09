/**
 * Time-zone math for scheduling, with no dependencies (browser and server safe).
 *
 * PT sessions are stored as a local date + wall-clock time + IANA zone. These
 * helpers turn that into real instants and back, so reminders, conflict checks
 * and Google sync all agree on when a session actually happens.
 */

export const DEFAULT_TZ = "America/Winnipeg";

function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(tz: string, at: Date): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz(tz),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

/** Milliseconds the zone is ahead of UTC at that instant (negative west of Greenwich). */
export function tzOffsetMs(tz: string, at: Date): number {
  const p = partsIn(tz, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

/** "2026-10-12" + "11:00" in America/Winnipeg → the real instant (2026-10-12T16:00Z). */
export function wallTimeToUtc(dateISO: string, timeHM: string, tz: string | null | undefined): Date {
  const zone = safeTz(tz);
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeHM.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const first = tzOffsetMs(zone, new Date(guess));
  let t = guess - first;
  const second = tzOffsetMs(zone, new Date(t));
  if (second !== first) t = guess - second;
  return new Date(t);
}

/** Calendar date (yyyy-mm-dd) of an instant in a zone. */
export function localDateISO(at: Date, tz: string | null | undefined): string {
  const p = partsIn(safeTz(tz), at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Hour of day (0-23) of an instant in a zone. */
export function localHour(at: Date, tz: string | null | undefined): number {
  return partsIn(safeTz(tz), at).hour;
}

/** Plain date arithmetic on yyyy-mm-dd strings (no zone involved). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Today's yyyy-mm-dd in the device's own zone (not UTC). */
export function deviceTodayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "HH:MM" + minutes, clamped to the same day. */
export function addMinutesHM(timeHM: string, minutes: number): string {
  const [h, m] = timeHM.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, (h || 0) * 60 + (m || 0) + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Minutes between two "HH:MM" strings (end - start). */
export function minutesBetweenHM(startHM: string, endHM: string): number {
  const [sh, sm] = startHM.split(":").map(Number);
  const [eh, em] = endHM.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/** "Mon Oct 12" for an instant, in a zone. */
export function fmtDayLabel(at: Date, tz: string | null | undefined): string {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz(tz),
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(at);
  return s.replace(",", "");
}

/** "11:00 AM" for an instant, in a zone. */
export function fmtClock(at: Date, tz: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz(tz),
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/** "11:00 AM" for a bare "HH:MM[:SS]" wall time. */
export function fmtWallClock(timeHM: string | null | undefined): string {
  if (!timeHM) return "";
  const [h, m] = timeHM.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

/** Half-open interval overlap: back-to-back sessions (11-12, 12-1) don't clash. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}
