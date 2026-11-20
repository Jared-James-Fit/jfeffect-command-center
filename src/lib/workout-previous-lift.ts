import { preferSameEquipment } from "@/lib/equipment/equipment";

export type PreviousLiftIdentity = {
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  repsOnly?: boolean;
  /** The card's role in the workout ("Primary Deadlift Backoff"), when the program names one. */
  purposeLabel?: string | null;
  /**
   * Done for time, so last time is time / calories / effort, never load × reps:
   * "cardio" (a walk, a bike: the session added up) or "hold" (a plank: the longest set).
   */
  timed?: "cardio" | "hold" | null;
  /**
   * The machine (or cable, Smith…) the card is on when it changes what a weight
   * means (equipment.ts loadEquipmentId): history is read on it when there is
   * some, never another machine's. Null / absent: every session counts.
   */
  equipmentId?: string | null;
};

export type PreviousLiftLog = {
  id: string;
  exerciseId: string | null;
  exerciseName: string | null;
  sessionKey: string;
  occurredAt: string | null;
  /**
   * The day its session was trained ("2026-09-20", trainedOn in
   * exercise-history.ts): which session is the latest, and the date "Last
   * time" says. occurredAt (when the set was saved) stays the engine's clock.
   */
  trainedOn?: string | null;
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
  /** The card (exercise row) it was logged on and that card's place in the workout. */
  rowId?: string | null;
  rowOrder?: number | null;
  /** A timed set's logged time and calories (cardio, holds). */
  durationSeconds?: number | null;
  calories?: number | null;
  /** A run's distance, in metres. */
  distanceM?: number | null;
  /** The athlete_equipment the set was done on, when it was stamped. */
  equipmentId?: string | null;
};

/** Last time for an exercise done for time. */
export type PreviousTimed = {
  kind: "cardio" | "hold";
  /** cardio: the session's time added up; hold: the longest set. */
  seconds: number | null;
  /** cardio only: the session's calories added up. */
  calories: number | null;
  /** cardio only: the session's distance added up, in metres (a run). */
  meters?: number | null;
  /** cardio: the hardest set's RPE; hold: the longest set's. */
  rpe: number | null;
  /** Sets that session. */
  sets: number;
};

export type PreviousLift = PreviousLiftLog & {
  match: "exercise_id" | "name";
  timed?: PreviousTimed;
  /** Nothing logged on the card's machine yet: this came from another one (the card says which). */
  otherEquipment?: boolean;
};

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

/** Newest session first: by the day it was trained, then by when it was saved. */
function newestFirst(a: PreviousLiftLog, b: PreviousLiftLog): number {
  const da = a.trainedOn ?? "";
  const db = b.trainedOn ?? "";
  if (da !== db && da && db) return da < db ? 1 : -1;
  return occurredAtMs(b) - occurredAtMs(a);
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
  const candidates = logs.filter((log) => log.isWorkingSet !== false);
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
  // All of the lift's sessions, not just this card's role: a role's own
  // history is thin and often light (a top set wave-loaded at RPE 4 predicted
  // 243 lb for 5 @ 5.5 when 315 @ 6 was the truth). The engine's reps/RPE
  // kernel already leans on the most similar sets.
  // On a machine: its own sessions (and ones that never said), never another
  // machine's weights, when there are any (equipment.ts preferSameEquipment).
  const own = matches.filter((log) => log.sessionKey !== currentSessionKey && occurredAtMs(log) > 0);
  return preferSameEquipment(own, identity.equipmentId).logs;
}

function hasTimedPerformance(log: PreviousLiftLog): boolean {
  return finitePositive(log.durationSeconds) != null || finitePositive(log.calories) != null || finitePositive(log.distanceM) != null || finitePositive(log.rpe) != null;
}

/**
 * Last time for a timed exercise, from that session's sets: a cardio session
 * reads like the plan counts it (time and calories added up, the hardest RPE;
 * the same as tg_pl_row_results_cardio_done and the History sheet), a hold by
 * its longest set.
 */
export function summarizeTimedSession(kind: "cardio" | "hold", sets: PreviousLiftLog[]): PreviousTimed {
  if (kind === "hold") {
    const longest = sets
      .filter((x) => finitePositive(x.durationSeconds) != null)
      .sort((a, b) => Number(b.durationSeconds) - Number(a.durationSeconds))[0];
    return {
      kind,
      seconds: longest ? Number(longest.durationSeconds) : null,
      calories: null,
      rpe: finitePositive((longest ?? sets[0])?.rpe),
      sets: sets.length,
    };
  }
  const secs = sets.map((x) => finitePositive(x.durationSeconds)).filter((n): n is number => n != null);
  const cals = sets.map((x) => finitePositive(x.calories)).filter((n): n is number => n != null);
  const meters = sets.map((x) => finitePositive(x.distanceM)).filter((n): n is number => n != null);
  const rpes = sets.map((x) => finitePositive(x.rpe)).filter((n): n is number => n != null);
  return {
    kind,
    seconds: secs.length ? Math.round(secs.reduce((t, n) => t + n, 0)) : null,
    calories: cals.length ? Math.round(cals.reduce((t, n) => t + n, 0)) : null,
    // a run's distance, only when one was logged (a walk or a bike reads as before)
    ...(meters.length ? { meters: Math.round(meters.reduce((t, n) => t + n, 0)) } : {}),
    rpe: rpes.length ? Math.max(...rpes) : null,
    sets: sets.length,
  };
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
      log.isWorkingSet !== false &&
      (identity.timed ? hasTimedPerformance(log) : hasUsefulPerformance(log, identity.repsOnly === true)),
    );
    if (valid.length === 0) continue;
    const onMachine = preferSameEquipment(valid, identity.equipmentId);
    const otherEquipment = onMachine.other;
    if (identity.timed) {
      // the same kind of session when there is one: a threshold run's last time
      // is the last threshold session, not last Sunday's long run
      const timedRole = normalizeRole(identity.purposeLabel);
      const sameKind = timedRole ? onMachine.logs.filter((log) => normalizeRole(log.purposeLabel) === timedRole) : [];
      const pool = sameKind.length > 0 ? sameKind : onMachine.logs;
      const latest = pool.slice().sort(newestFirst)[0];
      const session = pool.filter((log) => log.sessionKey === latest.sessionKey);
      result.set(identity.rowId, {
        ...latest,
        match: idMatches.length > 0 ? "exercise_id" : "name",
        timed: summarizeTimedSession(identity.timed, session),
        ...(otherEquipment ? { otherEquipment } : {}),
      });
      continue;
    }
    // Same lift twice in a workout (top set + back-off): Last Time is the same
    // card's last time, not the heaviest set of the lift (a back-off showed
    // last week's 224.5 kg top set instead of its own 143 kg). That's the
    // latest session that had this role, even when a later session of the lift
    // didn't (a back-off card after a heavy-singles day still reads its own
    // back-offs); with no history in this role, the lift's latest session.
    const role = normalizeRole(identity.purposeLabel);
    const inRole = role ? onMachine.logs.filter((log) => normalizeRole(log.purposeLabel) === role) : [];
    const pool = inRole.length > 0 ? inRole : onMachine.logs;
    const latestSession = pool.slice().sort(newestFirst)[0]?.sessionKey;
    if (!latestSession) continue;
    const lastSession = pool.filter((log) => log.sessionKey === latestSession);
    // Working sets only: warm-ups live in their own table (pl_warmup_sets) and
    // never reach this list, and a set flagged not working is never Last Time.
    const top = bestSet(lastSession);
    if (!top) continue;
    result.set(identity.rowId, {
      ...top,
      match: idMatches.length > 0 ? "exercise_id" : "name",
      ...(otherEquipment ? { otherEquipment } : {}),
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
/** "20:30 · 162 kcal · RPE 5.5" (cardio), "32:10 · 5.4 km · RPE 4" (a run), "0:45 · RPE 7" (a hold), "" when nothing was logged. */
export function formatPreviousTimed(t: PreviousTimed, clock: (seconds: number) => string, distance?: (meters: number) => string): string {
  const rpe = t.rpe != null ? `RPE ${Math.round(t.rpe * 10) / 10}` : null;
  const dist = t.meters != null && t.meters > 0 && distance ? distance(t.meters) : null;
  return [t.seconds != null ? clock(t.seconds) : null, dist, t.calories != null ? `${t.calories} kcal` : null, rpe]
    .filter(Boolean)
    .join(" · ");
}
