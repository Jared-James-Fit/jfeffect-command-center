/**
 * Distance, pace and the run prescription line, for running sets in the
 * workout logger and anything that reads them back (history, analytics).
 * Pure (tested).
 *
 * A logged set stores its distance in metres (pl_row_results.actual_distance_m)
 * with the unit it was typed in (actual_distance_unit: km, the default, or mi),
 * so any screen can show it in either unit and a run typed in miles still
 * reads in miles. Pace is never stored: it's time ÷ distance, from the sets
 * that have both.
 */
import { formatClockSeconds } from "@/lib/duration";
import { isTimedCardio } from "@/lib/timed-cardio";

export type DistanceUnit = "km" | "mi";
export const METERS_PER: Record<DistanceUnit, number> = { km: 1000, mi: 1609.344 };
/** what one set can hold (the database allows the same): 300 km */
export const MAX_SET_DISTANCE_M = 300_000;

const RUN_RE = /\b(run|running|jog|jogging)\b/i;
/** A run (not a walk, a bike or a lunge): its sets log distance by default. */
export function isRunningExercise(name: string | null | undefined): boolean {
  return isTimedCardio(name) && RUN_RE.test(String(name ?? ""));
}

export const isDistanceUnit = (u: unknown): u is DistanceUnit => u === "km" || u === "mi";

const trim = (n: number, dp: number) => String(Number(n.toFixed(dp)));

/** What the distance box shows: 5200 m → "5.2" (km), "3.23" (mi). Empty for nothing. */
export function distanceInputValue(meters: number | null | undefined, unit: DistanceUnit): string {
  const v = Number(meters);
  if (!Number.isFinite(v) || v <= 0) return "";
  return trim(v / METERS_PER[unit], 2);
}

/** "5.2" / "5,2" typed in km (or mi) → metres; null for nothing or a value a set can't hold. */
export function parseDistanceInput(raw: string | null | undefined, unit: DistanceUnit): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
  const meters = Math.round(Number(s) * METERS_PER[unit] * 10) / 10;
  return meters > 0 && meters <= MAX_SET_DISTANCE_M ? meters : null;
}

/** "5.2 km", "13.1 mi", "850 m" (under 1 km, in km), "" for nothing. */
export function formatDistance(meters: number | null | undefined, unit: DistanceUnit): string {
  const v = Number(meters);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (unit === "km" && v < 1000) return `${Math.round(v)} m`;
  const n = v / METERS_PER[unit];
  return `${trim(n, n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${unit}`;
}

/** Seconds per km (or mile); null without both. */
export function paceSeconds(seconds: number | null | undefined, meters: number | null | undefined, unit: DistanceUnit): number | null {
  const s = Number(seconds);
  const mm = Number(meters);
  if (!Number.isFinite(s) || !Number.isFinite(mm) || s <= 0 || mm <= 0) return null;
  return s / (mm / METERS_PER[unit]);
}

/** "5:42 /km", "" when there's none. */
export function formatPace(secPerUnit: number | null | undefined, unit: DistanceUnit): string {
  const p = Number(secPerUnit);
  if (!Number.isFinite(p) || p <= 0) return "";
  return `${formatClockSeconds(Math.round(p))} /${unit}`;
}

export type RunSet = { durationSeconds?: number | null; distanceM?: number | null };

/** A run's totals: all its time and distance, and pace from the sets that have both. */
export function runTotals(sets: RunSet[]) {
  let seconds = 0;
  let meters = 0;
  let pacedSeconds = 0;
  let pacedMeters = 0;
  for (const s of sets) {
    const t = Number(s.durationSeconds) > 0 ? Number(s.durationSeconds) : 0;
    const d = Number(s.distanceM) > 0 ? Number(s.distanceM) : 0;
    seconds += t;
    meters += d;
    if (t && d) {
      pacedSeconds += t;
      pacedMeters += d;
    }
  }
  return { seconds, meters, pacedSeconds, pacedMeters };
}

/** "5.2 km · 29:40 · 5:42 /km" under a run's sets; null until there's a distance. */
export function runSummaryLine(sets: RunSet[], unit: DistanceUnit): string | null {
  const t = runTotals(sets);
  if (!t.meters) return null;
  const pace = paceSeconds(t.pacedSeconds, t.pacedMeters, unit);
  return [formatDistance(t.meters, unit), t.seconds ? formatClockSeconds(t.seconds) : null, pace ? formatPace(pace, unit) : null]
    .filter(Boolean)
    .join(" · ");
}

/** What the rest between run sets is: walking on run/walk and strides, an easy jog on everything else (rest for non-running cardio). */
export function recoveryWord(role: string | null | undefined, run = true): string {
  if (!run) return "rest";
  const r = String(role ?? "").trim().toLowerCase();
  return r === "run/walk" || r === "strides" ? "walk" : "easy jog";
}

const mins = (seconds: number) => {
  if (seconds < 60) return `${seconds} s`;
  const m = seconds / 60;
  if (m >= 60 && Number.isInteger(m)) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  return Number.isInteger(m) ? `${m} min` : formatClockSeconds(seconds);
};

/**
 * A run's prescription line, written the way a runner reads it:
 *   "40 min | RPE 3–4"
 *   "3 × 8 min · 2 min easy jog between | RPE 6–7"
 *   "8 × 1 min · 1:30 walk between | RPE 3–4"
 *   "5 km | RPE 4–6" (no time target)
 */
export function runPrescription(p: {
  /** a run (its recovery is a walk or a jog); other cardio rests */
  run?: boolean;
  sets: number | null | undefined;
  durationSeconds: number | null | undefined;
  restSeconds: number | null | undefined;
  repsText?: string | null;
  role?: string | null;
  rpe?: string | null;
}): string {
  const sets = Math.max(1, Number(p.sets) || 1);
  const dur = Number(p.durationSeconds) > 0 ? Number(p.durationSeconds) : null;
  const what = dur ? mins(dur) : String(p.repsText ?? "").trim() || "Run";
  const main = sets > 1 ? `${sets} × ${what}` : what;
  const rest = Number(p.restSeconds) > 0 && sets > 1 ? `${mins(Number(p.restSeconds))} ${recoveryWord(p.role, p.run !== false)} between` : null;
  const rpe = String(p.rpe ?? "").trim();
  return [[main, rest].filter(Boolean).join(" · "), rpe ? `RPE ${rpe.replace(/\s*-\s*/g, "–")}` : null].filter(Boolean).join(" | ");
}

const UNIT_KEY = "jf.run-distance-unit";
/** The km / mi the athlete last picked on this phone (km until they pick miles). */
export function readDistanceUnit(): DistanceUnit {
  try {
    const v = globalThis.localStorage?.getItem(UNIT_KEY);
    return isDistanceUnit(v) ? v : "km";
  } catch {
    return "km";
  }
}
export function writeDistanceUnit(u: DistanceUnit): void {
  try {
    globalThis.localStorage?.setItem(UNIT_KEY, u);
  } catch {
    /* private mode: the default (km) stays */
  }
}
