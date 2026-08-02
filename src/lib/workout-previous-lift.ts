export type PreviousLiftIdentity = {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  repsOnly?: boolean;
};

export type PreviousLiftLog = {
  id: string;
  exerciseId: string | null;
  exerciseName: string | null;
  sessionKey: string;
  occurredAt: string | null;
  reps: number | null;
  rpe: number | string | null;
  rir: number | string | null;
  enteredValue: number | null;
  enteredUnit: "kg" | "lb" | null;
  normalizedKg: number | null;
  normalizedLb: number | null;
  isWorkingSet: boolean | null;
};

export type PreviousLift = PreviousLiftLog & { match: "exercise_id" | "name" };

const COMPETITION_WORDS = new Set(["competition", "comp"]);

/**
 * Conservative exercise-name fallback. Punctuation, dash variants and word
 * spacing are ignored. Competition may appear before or after the lift name,
 * while unrelated movement words (machine, chest, shoulder, leg) are kept so
 * distinct exercises cannot collapse into one key.
 */
export function normalizeExerciseHistoryName(value: string | null | undefined): string {
  const words = String(value ?? "")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const hasCompetition = words.some((word) => COMPETITION_WORDS.has(word));
  const withoutCompetition = words.filter((word) => !COMPETITION_WORDS.has(word));
  if (hasCompetition && withoutCompetition.includes("bench")) {
    return withoutCompetition.filter((word) => word !== "press").join(" ");
  }
  return withoutCompetition.join(" ");
}

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function occurredAtMs(log: PreviousLiftLog): number {
  const value = log.occurredAt ? Date.parse(log.occurredAt) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

function hasUsefulPerformance(log: PreviousLiftLog, repsOnly: boolean): boolean {
  const reps = finitePositive(log.reps);
  if (!reps) return false;
  const load = finitePositive(log.normalizedKg) ?? finitePositive(log.normalizedLb) ?? finitePositive(log.enteredValue);
  if (load) return true;
  if (!repsOnly) return false;
  return reps > 0 || finitePositive(log.rpe) != null || finitePositive(log.rir) != null;
}

function loadInLb(log: PreviousLiftLog): number {
  const normalized = finitePositive(log.normalizedLb);
  if (normalized != null) return normalized;
  const kg = finitePositive(log.normalizedKg);
  if (kg != null) return kg * 2.2046226218;
  const entered = finitePositive(log.enteredValue);
  if (entered == null) return 0;
  return log.enteredUnit === "kg" ? entered * 2.2046226218 : entered;
}

function bestSet(logs: PreviousLiftLog[]): PreviousLiftLog | null {
  const working = logs.filter((log) => log.isWorkingSet !== false);
  const candidates = working.length > 0 ? working : logs;
  return candidates.slice().sort((a, b) => {
    const loadDifference = loadInLb(b) - loadInLb(a);
    if (Math.abs(loadDifference) > 0.001) return loadDifference;
    return Number(b.reps ?? 0) - Number(a.reps ?? 0);
  })[0] ?? null;
}

/** Select one Last Time set per current workout row from a single history batch. */
export function selectPreviousLifts(
  identities: PreviousLiftIdentity[],
  logs: PreviousLiftLog[],
  currentSessionKey: string,
): Map<string, PreviousLift> {
  const result = new Map<string, PreviousLift>();
  for (const identity of identities) {
    const normalizedName = normalizeExerciseHistoryName(identity.exerciseName);
    const idMatches = identity.exerciseId
      ? logs.filter((log) => log.exerciseId === identity.exerciseId)
      : [];
    const matches = idMatches.length > 0
      ? idMatches
      : logs.filter((log) => {
          if (!normalizedName) return false;
          return normalizeExerciseHistoryName(log.exerciseName) === normalizedName;
        });
    const valid = matches.filter((log) =>
      log.sessionKey !== currentSessionKey &&
      occurredAtMs(log) > 0 &&
      hasUsefulPerformance(log, identity.repsOnly === true),
    );
    if (valid.length === 0) continue;
    const latestSession = valid.slice().sort((a, b) => occurredAtMs(b) - occurredAtMs(a))[0]?.sessionKey;
    if (!latestSession) continue;
    const top = bestSet(valid.filter((log) => log.sessionKey === latestSession));
    if (!top) continue;
    result.set(identity.rowId, {
      ...top,
      match: idMatches.length > 0 ? "exercise_id" : "name",
    });
  }
  return result;
}

export function formatPreviousLiftLoad(log: PreviousLiftLog, unit: "kg" | "lb"): string | null {
  let value = unit === "kg" ? finitePositive(log.normalizedKg) : finitePositive(log.normalizedLb);
  if (value == null) {
    const other = unit === "kg" ? finitePositive(log.normalizedLb) : finitePositive(log.normalizedKg);
    if (other != null) value = unit === "kg" ? other / 2.2046226218 : other * 2.2046226218;
  }
  if (value == null && log.enteredValue != null && log.enteredUnit) {
    value = log.enteredUnit === unit
      ? finitePositive(log.enteredValue)
      : finitePositive(log.enteredValue) == null
        ? null
        : unit === "kg"
          ? Number(log.enteredValue) / 2.2046226218
          : Number(log.enteredValue) * 2.2046226218;
  }
  if (value == null) return null;
  const rounded = Math.abs(value - Math.round(value)) < 0.05 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${unit}`;
}