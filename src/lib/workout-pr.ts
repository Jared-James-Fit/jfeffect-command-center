import {
  normalizeExerciseHistoryName,
  type PreviousLiftIdentity,
  type PreviousLiftLog,
} from "./workout-previous-lift";

/**
 * Exact rep-max PR detection.
 *
 * A PR is valid only when a logged set beats the client's previous historical
 * best for the SAME exercise (canonical id, else conservative normalized-name
 * fallback — same matching rules as the Last Time system) at the SAME exact
 * rep count (1–12). The current workout session is always excluded from the
 * baseline, so reopening a saved workout keeps badges stable and today's
 * earlier sets never become the baseline for later sets.
 */

export const PR_MAX_REPS = 12;

const LB_PER_KG = 2.2046226218;

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Load of a historical log converted into `unit`, or null when unknown. */
export function logLoadInUnit(log: PreviousLiftLog, unit: "kg" | "lb"): number | null {
  const direct = unit === "kg" ? finitePositive(log.normalizedKg) : finitePositive(log.normalizedLb);
  if (direct != null) return direct;
  const other = unit === "kg" ? finitePositive(log.normalizedLb) : finitePositive(log.normalizedKg);
  if (other != null) return unit === "kg" ? other / LB_PER_KG : other * LB_PER_KG;
  if (log.enteredValue != null && log.enteredUnit) {
    const entered = finitePositive(log.enteredValue);
    if (entered != null) {
      return log.enteredUnit === unit
        ? entered
        : unit === "kg"
          ? entered / LB_PER_KG
          : entered * LB_PER_KG;
    }
  }
  return null;
}

function logLoadLb(log: PreviousLiftLog): number | null {
  return logLoadInUnit(log, "lb");
}

function occurredAtMs(log: PreviousLiftLog): number {
  const v = log.occurredAt ? Date.parse(log.occurredAt) : Number.NaN;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Best (heaviest) historical working set per exact rep count 1..PR_MAX_REPS.
 * Matching priority mirrors selectPreviousLifts: canonical exercise id first,
 * conservative normalized-name fallback only when no id match exists.
 */
export function computeRepMaxBests(
  identity: PreviousLiftIdentity,
  logs: PreviousLiftLog[],
  currentSessionKey: string,
): Map<number, PreviousLiftLog> {
  const result = new Map<number, PreviousLiftLog>();
  const normalizedName = normalizeExerciseHistoryName(identity.exerciseName);
  const idMatches = identity.exerciseId
    ? logs.filter((log) => log.exerciseId === identity.exerciseId)
    : [];
  const matches = idMatches.length > 0
    ? idMatches
    : normalizedName
      ? logs.filter((log) => normalizeExerciseHistoryName(log.exerciseName) === normalizedName)
      : [];
  const valid = matches.filter(
    (log) =>
      log.sessionKey !== currentSessionKey &&
      occurredAtMs(log) > 0 &&
      log.isWorkingSet !== false &&
      (log.loadType ?? "external") === "external",
  );
  for (const log of valid) {
    const reps = finitePositive(log.reps);
    if (reps == null) continue;
    const repsInt = Math.round(reps);
    if (repsInt < 1 || repsInt > PR_MAX_REPS || Math.abs(reps - repsInt) > 0.001) continue;
    if (logLoadLb(log) == null) continue;
    const prev = result.get(repsInt);
    if (!prev || (logLoadLb(log) ?? 0) > (logLoadLb(prev) ?? 0)) {
      result.set(repsInt, log);
    }
  }
  return result;
}

export type SetPR = {
  reps: number;
  /** Amount added vs the previous historical best, in `unit`. Always > 0. */
  amount: number;
  unit: "kg" | "lb";
};

function roundDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Detect whether a single logged set is an exact rep-max PR.
 * Comparison happens in lb (canonical); the amount added is computed in the
 * card's current display unit without double-conversion.
 */
export function detectSetPR(
  set: { reps: number | null; load: number | null; loadUnit: "kg" | "lb" | null },
  bests: Map<number, PreviousLiftLog>,
  displayUnit: "kg" | "lb",
): SetPR | null {
  const reps = finitePositive(set.reps);
  const load = finitePositive(set.load);
  if (reps == null || load == null) return null;
  const repsInt = Math.round(reps);
  if (repsInt < 1 || repsInt > PR_MAX_REPS || Math.abs(reps - repsInt) > 0.001) return null;
  const best = bests.get(repsInt);
  if (!best) return null; // no historical baseline → never fabricate a PR
  const setUnit: "kg" | "lb" = set.loadUnit === "kg" || set.loadUnit === "lb" ? set.loadUnit : displayUnit;
  const newLb = setUnit === "lb" ? load : load * LB_PER_KG;
  const oldLb = logLoadLb(best);
  if (oldLb == null) return null;
  if (newLb <= oldLb + 0.001) return null; // ties and lower weights are not PRs
  const newDisplay = setUnit === displayUnit ? load : displayUnit === "kg" ? newLb / LB_PER_KG : newLb;
  const oldDisplay = logLoadInUnit(best, displayUnit);
  if (oldDisplay == null) return null;
  const amount = roundDisplay(roundDisplay(newDisplay) - roundDisplay(oldDisplay));
  if (!(amount > 0)) return null;
  return { reps: repsInt, amount, unit: displayUnit };
}

/* ---------------------------------------------------------------------- */
/* Assisted (counterweight machine) PRs — LOWER assistance is better.       */
/* ---------------------------------------------------------------------- */

/** Lowest historical assistance per exact rep count for an assisted exercise. */
export function computeAssistedBests(
  identity: PreviousLiftIdentity,
  logs: PreviousLiftLog[],
  currentSessionKey: string,
): Map<number, PreviousLiftLog> {
  const result = new Map<number, PreviousLiftLog>();
  const normalizedName = normalizeExerciseHistoryName(identity.exerciseName);
  const idMatches = identity.exerciseId
    ? logs.filter((log) => log.exerciseId === identity.exerciseId)
    : [];
  const matches = idMatches.length > 0
    ? idMatches
    : normalizedName
      ? logs.filter((log) => normalizeExerciseHistoryName(log.exerciseName) === normalizedName)
      : [];
  const valid = matches.filter(
    (log) =>
      log.sessionKey !== currentSessionKey &&
      occurredAtMs(log) > 0 &&
      log.isWorkingSet !== false &&
      log.loadType === "assisted",
  );
  for (const log of valid) {
    const reps = finitePositive(log.reps);
    if (reps == null) continue;
    const repsInt = Math.round(reps);
    if (repsInt < 1 || repsInt > PR_MAX_REPS || Math.abs(reps - repsInt) > 0.001) continue;
    const assist = logLoadLb(log);
    if (assist == null) continue;
    const prev = result.get(repsInt);
    if (!prev || assist < (logLoadLb(prev) ?? Infinity)) result.set(repsInt, log);
  }
  return result;
}

export type AssistedPR = {
  reps: number;
  /** Assistance REMOVED vs the previous best, in `unit`. Always > 0. */
  amount: number;
  unit: "kg" | "lb";
  assisted: true;
};

/**
 * An assisted PR is the same reps at LESS assistance than the previous best.
 * Higher assistance is never a PR.
 */
export function detectAssistedSetPR(
  set: { reps: number | null; load: number | null; loadUnit: "kg" | "lb" | null },
  bests: Map<number, PreviousLiftLog>,
  displayUnit: "kg" | "lb",
): AssistedPR | null {
  const reps = finitePositive(set.reps);
  const load = set.load != null && Number.isFinite(Number(set.load)) && Number(set.load) >= 0
    ? Number(set.load)
    : null;
  if (reps == null || load == null) return null;
  const repsInt = Math.round(reps);
  if (repsInt < 1 || repsInt > PR_MAX_REPS || Math.abs(reps - repsInt) > 0.001) return null;
  const best = bests.get(repsInt);
  if (!best) return null;
  const setUnit: "kg" | "lb" = set.loadUnit === "kg" || set.loadUnit === "lb" ? set.loadUnit : displayUnit;
  const newLb = setUnit === "lb" ? load : load * LB_PER_KG;
  const oldLb = logLoadLb(best);
  if (oldLb == null) return null;
  if (newLb >= oldLb - 0.001) return null; // same or more assistance is not a PR
  const newDisplay = setUnit === displayUnit ? load : displayUnit === "kg" ? newLb / LB_PER_KG : newLb;
  const oldDisplay = logLoadInUnit(best, displayUnit);
  if (oldDisplay == null) return null;
  const amount = roundDisplay(roundDisplay(oldDisplay) - roundDisplay(newDisplay));
  if (!(amount > 0)) return null;
  return { reps: repsInt, amount, unit: displayUnit, assisted: true };
}
