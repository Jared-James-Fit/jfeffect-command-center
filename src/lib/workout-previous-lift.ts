export type PreviousLiftIdentity = {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  repsOnly?: boolean;
  /** The card's role in the workout ("Primary Deadlift Backoff"), when the program names one. */
  purposeLabel?: string | null;
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
  /** external | bodyweight | assisted. Absent on legacy in-memory fixtures. */
  loadType?: "external" | "bodyweight" | "assisted";
  /** Athlete's smoothed bodyweight (kg) when this set was logged, when known. */
  bodyweightKg?: number | null;
  /** Role of the card it was logged on, when the program named one. */
  purposeLabel?: string | null;
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

/**
 * Canonical exercise identities that a history view may read for one row.
 *
 * Returns the row's own exercise id plus any OTHER library rows whose name
 * normalizes to exactly the same key (duplicate library entries, cosmetic
 * renames, archived predecessors). Names that merely look similar
 * ("Hip Thrust - Barbell" vs "Hip Thrust Machine") normalize differently and
 * are therefore never merged.
 *
 * Both the History sheet and the LAST TIME badge resolve identity through
 * this one helper so they can never disagree.
 */
export function matchingHistoryExerciseIds(
  exerciseId: string | null | undefined,
  exerciseName: string | null | undefined,
  catalog: Array<{ id: string; name?: string | null }> = [],
): string[] {
  const ids = new Set<string>();
  if (exerciseId) ids.add(exerciseId);
  const key = normalizeExerciseHistoryName(exerciseName);
  if (key) {
    for (const entry of catalog) {
      if (!entry?.id) continue;
      if (normalizeExerciseHistoryName(entry.name) === key) ids.add(entry.id);
    }
  }
  return [...ids];
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

const normalizeRole = (label: string | null | undefined): string =>
  (label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * This exercise's logs from OTHER sessions: canonical exercise id first,
 * conservative normalized-name fallback only when no id match exists.
 */
export function matchHistoryLogs(
  identity: PreviousLiftIdentity,
  logs: PreviousLiftLog[],
  currentSessionKey: string,
): PreviousLiftLog[] {
  const normalizedName = normalizeExerciseHistoryName(identity.exerciseName);
  const idMatches = identity.exerciseId ? logs.filter((log) => log.exerciseId === identity.exerciseId) : [];
  const matches = idMatches.length > 0
    ? idMatches
    : normalizedName
      ? logs.filter((log) => normalizeExerciseHistoryName(log.exerciseName) === normalizedName)
      : [];
  const other = matches.filter((log) => log.sessionKey !== currentSessionKey && occurredAtMs(log) > 0);
  // A named role (a back-off, a primer) learns from the same role when there's
  // enough of it (2+ sessions): a sumo back-off isn't predicted from the
  // conventional top set it follows.
  const role = normalizeRole(identity.purposeLabel);
  if (!role) return other;
  const sameRole = other.filter((log) => normalizeRole(log.purposeLabel) === role);
  return new Set(sameRole.map((log) => log.sessionKey)).size >= 2 ? sameRole : other;
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
    // Same lift twice in a workout (top set + back-off): Last Time is the same
    // card last session, not the heaviest set of the lift (a back-off showed
    // last week's 224.5 kg top set instead of its own 143 kg).
    const role = normalizeRole(identity.purposeLabel);
    const lastSession = valid.filter((log) => log.sessionKey === latestSession);
    const sameRole = role ? lastSession.filter((log) => normalizeRole(log.purposeLabel) === role) : [];
    const top = bestSet(sameRole.length > 0 ? sameRole : lastSession);
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