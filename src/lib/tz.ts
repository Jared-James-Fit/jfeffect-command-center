// Convert a wall-clock date+time string in a given IANA timezone to a UTC ISO string.
// Works without external deps using Intl.DateTimeFormat.
export function tzWallToUtcMs(date: string, time: string, tz: string): number {
  // Treat input as if it were UTC, then compute how that instant renders in the
  // target TZ; the difference is the TZ offset to subtract.
  const naiveUtc = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(naiveUtc)) return NaN;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(naiveUtc));
  const lk: Record<string, string> = {};
  for (const p of parts) lk[p.type] = p.value;
  const hour = lk.hour === "24" ? 0 : Number(lk.hour);
  const asUtcOfTz = Date.UTC(+lk.year, +lk.month - 1, +lk.day, hour, +lk.minute, +lk.second);
  const offset = asUtcOfTz - naiveUtc;
  return naiveUtc - offset;
}

export function tzWallToUtcISO(date: string, time: string, tz: string): string {
  return new Date(tzWallToUtcMs(date, time, tz)).toISOString();
}

// Hour-of-day (0..23) in a given timezone for an absolute instant.
export function hourInTz(ms: number, tz: string): number {
  const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(ms);
  const n = Number(h);
  return n === 24 ? 0 : n;
}

export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "America/Toronto", label: "Toronto" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris / Berlin" },
  { value: "Europe/Athens", label: "Athens" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "UTC", label: "UTC" },
];

export const DAYPARTS = {
  all: { label: "Show all", from: 5, to: 22 },
  morning: { label: "Morning", from: 5, to: 12 },
  afternoon: { label: "Afternoon", from: 12, to: 17 },
  evening: { label: "Evening", from: 17, to: 22 },
} as const;
export type DaypartKey = keyof typeof DAYPARTS;