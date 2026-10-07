/**
 * Pure helpers for the birthday push. The hook runs hourly; a birthday push is
 * due once the client's LOCAL calendar date is their birthday and it is
 * morning-or-later for them. (It used to compare against the UTC date, which
 * made a Winnipeg client's "Happy Birthday" arrive around 7pm the evening
 * before.) The caller dedupes per user per year, so being due for several hourly
 * runs still sends once.
 */

const DEFAULT_TZ = "America/Winnipeg";
export const BIRTHDAY_PUSH_FROM_HOUR = 9;
export const BIRTHDAY_PUSH_UNTIL_HOUR = 21;

function localParts(tz: string, at: Date): { year: number; month: number; day: number; hour: number } {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = fmt(tz); } catch { parts = fmt(DEFAULT_TZ); }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24 };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** `dob` is YYYY-MM-DD. Returns the local year when the push is due now, else null. */
export function birthdayPushYear(
  dob: string | null | undefined,
  tz: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const bm = Number(dob.slice(5, 7));
  const bd = Number(dob.slice(8, 10));
  const l = localParts(tz || DEFAULT_TZ, now);
  if (l.hour < BIRTHDAY_PUSH_FROM_HOUR || l.hour >= BIRTHDAY_PUSH_UNTIL_HOUR) return null;
  const sameDay = l.month === bm && l.day === bd;
  // A Feb 29 birthday is celebrated on Feb 28 in non-leap years.
  const leapDayInCommonYear = bm === 2 && bd === 29 && !isLeap(l.year) && l.month === 2 && l.day === 28;
  return sameDay || leapDayInCommonYear ? l.year : null;
}
