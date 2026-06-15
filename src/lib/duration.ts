/**
 * Duration parsing and formatting for time-based exercises.
 * Single source of truth is integer seconds.
 */

export function parseDurationInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;

  // mm:ss
  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) {
    const m = parseInt(colon[1], 10);
    const sec = parseInt(colon[2], 10);
    if (sec >= 60) return null;
    const total = m * 60 + sec;
    return total > 0 ? total : null;
  }

  // "1m 30s", "2 min", "45 sec", "1 min 30 sec", "1h 5m"
  const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let matched = false;
  let rest = s;
  while ((match = re.exec(s)) !== null) {
    matched = true;
    const n = parseFloat(match[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = match[2];
    if (unit.startsWith("h")) total += n * 3600;
    else if (unit.startsWith("m")) total += n * 60;
    else total += n;
    rest = rest.replace(match[0], "");
  }
  if (matched) {
    if (rest.replace(/[\s,]/g, "") !== "") return null;
    const rounded = Math.round(total);
    return rounded > 0 ? rounded : null;
  }

  // bare number → seconds
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.round(parseFloat(s));
    return n > 0 ? n : null;
  }

  return null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total} sec`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} sec`;
}

export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

// ── New, simpler API for the coach builder ──────────────────────────────────
// The builder is `Duration [ number ] [ sec ▼ / min ▼ ]`. Seconds remain the
// single source of truth. These helpers keep input ↔ stored value
// non-destructive when the unit toggle flips.

export type DurationUnit = "sec" | "min";

/**
 * Convert a (number, unit) pair to integer seconds.
 * - `sec`: whole numbers only.
 * - `min`: decimals allowed (rounded to nearest second).
 * - Returns `null` for empty / non-finite / non-positive inputs.
 */
export function secondsFromUnit(value: string | number | null | undefined, unit: DurationUnit): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const seconds = unit === "min" ? n * 60 : n;
  const rounded = Math.round(seconds);
  return rounded > 0 ? rounded : null;
}

/**
 * Turn integer seconds into the value that should appear inside the unit's
 * input box. Round-trippable with `secondsFromUnit`:
 *   secondsFromUnit(splitForUnit(90, "min"), "min") === 90
 *   secondsFromUnit(splitForUnit(90, "sec"), "sec") === 90
 */
export function splitForUnit(seconds: number | null | undefined, unit: DurationUnit): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  if (unit === "sec") return String(total);
  // minutes — use a 1-decimal representation when there's a remainder, but
  // collapse trailing zeros so "60 sec" displays as "1" rather than "1.0".
  const mins = total / 60;
  if (Number.isInteger(mins)) return String(mins);
  return String(Math.round(mins * 100) / 100);
}

/** Pick the best default unit for an existing duration (used on first render). */
export function preferredUnit(seconds: number | null | undefined): DurationUnit {
  if (!seconds || seconds < 60) return "sec";
  return "min";
}

/** Human "Work: 45 sec" / "1 min 30 sec" — alias kept for call-site clarity. */
export const formatDurationHuman = formatDuration;