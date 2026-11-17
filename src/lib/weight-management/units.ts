/**
 * Units for weight management. Everything is worked out in kilograms, metres
 * and miles per hour (the unit cardio_targets stores treadmill speed in), and
 * only turned into the person's unit when it's shown. Pure.
 */

export const LB_PER_KG = 2.2046226218;
export const KMH_PER_MPH = 1.609344;
export const DAY_MS = 86_400_000;

export type WeightUnit = "kg" | "lb";
export type SpeedUnit = "mph" | "kmh";

export const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

export const toKg = (v: number, unit: WeightUnit) => (unit === "lb" ? v / LB_PER_KG : v);
export const fromKg = (kg: number, unit: WeightUnit) => (unit === "lb" ? kg * LB_PER_KG : kg);

/** "182.4 lb" / "82.7 kg". */
export function fmtWeight(kg: number, unit: WeightUnit, digits = 1): string {
  return `${round(fromKg(kg, unit), digits)} ${unit}`;
}

/** "−0.4 lb a week" / "+0.25 kg a week", with a real minus sign. */
export function fmtRate(kgPerWeek: number, unit: WeightUnit): string {
  const v = fromKg(kgPerWeek, unit);
  const r = Math.abs(v) < 0.1 ? round(v, 2) : round(v, 1);
  if (r === 0) return `0 ${unit} a week`;
  return `${r > 0 ? "+" : "−"}${Math.abs(r)} ${unit} a week`;
}

/** "−0.6%" / "+0.25%" of bodyweight. */
export function fmtPct(pct: number): string {
  const r = Math.abs(pct) < 0.1 ? round(pct, 2) : round(pct, 1);
  if (r === 0) return "0%";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

export const mphToKmh = (mph: number) => mph * KMH_PER_MPH;
export const kmhToMph = (kmh: number) => kmh / KMH_PER_MPH;

/**
 * A treadmill speed as the person's treadmill shows it ("3.0 mph", "4.8 km/h"),
 * always one decimal and the unit spelled out, so nobody sets 3.0 km/h for 3.0 mph.
 */
export function fmtSpeed(mph: number, unit: SpeedUnit): string {
  const v = unit === "kmh" ? mphToKmh(mph) : mph;
  return `${v.toFixed(1)} ${unit === "kmh" ? "km/h" : "mph"}`;
}

/**
 * A speed rounded to what a treadmill can be set to (0.1 in its own unit),
 * returned in mph for storage. 3.0 mph shown in km/h is 4.8 km/h, stored as
 * 4.8 km/h in mph so the display never drifts to 4.9.
 */
export function treadmillSpeedMph(mph: number, unit: SpeedUnit): number {
  if (unit === "kmh") return kmhToMph(round(mphToKmh(mph), 1));
  return round(mph, 1);
}

/** The speed unit to start with: whatever they weigh in, a pound user's treadmill reads mph. */
export const speedUnitFor = (weightUnit: WeightUnit | null | undefined): SpeedUnit =>
  weightUnit === "kg" ? "kmh" : "mph";

/** Days from a to b (YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Monday" for a YYYY-MM-DD. */
export function weekdayOf(iso: string): string {
  return WEEKDAY_NAMES[new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay()];
}

/** "Mar 14" (this year) or "Mar 14, 2027". */
export function fmtDay(iso: string, today?: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const sameYear = today ? today.slice(0, 4) === iso.slice(0, 4) : false;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
