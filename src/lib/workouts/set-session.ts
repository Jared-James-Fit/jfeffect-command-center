/**
 * Which of an exercise card's sets the athlete added in the logger and which
 * of the program's sets they skipped today, kept on this phone per workout.
 * The rules are pure (tested); the store is a tiny localStorage-backed map the
 * card and the workout's progress both read.
 *
 * The program's prescription is `pl_exercise_rows.sets` until the athlete
 * first taps + Add set on that workout: then the count it had is remembered as
 * `planned`, and every set past it is one they added. An added set can be
 * deleted (the row's count goes down and its logged numbers go, with Undo). A
 * set from the program is never deleted from the logger: it's skipped, which
 * only hides it here (`skipped`, the card shows that many fewer) while the
 * prescription stays, so the coach and every analytic still see it was planned
 * and not done. A phone that never saw the + Add set treats every set as the
 * program's: the safe side (Skip, never Delete).
 */

export type SetSession = {
  /** The program's set count before the first + Add set here; null: nothing added on this phone. */
  planned: number | null;
  /** How many of the program's sets were skipped today (hidden, never deleted). */
  skipped: number;
};

export const EMPTY_SET_SESSION: SetSession = { planned: null, skipped: 0 };

/** The program's sets among the row's `sets` (never more than the row has). */
export function plannedSets(dbSets: number, s: SetSession): number {
  const sets = Math.max(1, Number(dbSets) || 1);
  return s.planned == null ? sets : Math.max(1, Math.min(sets, s.planned));
}

/** How many skips can stand: never more than the program's sets, and the card always keeps one set. */
export function skippedSets(dbSets: number, s: SetSession): number {
  const sets = Math.max(1, Number(dbSets) || 1);
  return Math.max(0, Math.min(s.skipped, plannedSets(sets, s), sets - 1));
}

/** The sets the card shows: the row's, less the ones skipped today (at least one). */
export function shownSetCount(dbSets: number, s: SetSession): number {
  const sets = Math.max(1, Number(dbSets) || 1);
  return Math.max(1, sets - skippedSets(sets, s));
}

/**
 * What a shown set is: the program's (the first ones, less any skipped) or one
 * the athlete added (the last ones).
 */
export function setKindAt(index: number, dbSets: number, s: SetSession): "planned" | "added" {
  return index <= plannedSets(dbSets, s) - skippedSets(dbSets, s) ? "planned" : "added";
}

/** What taking a set out does: Delete an added one, Skip one of the program's; nothing when it's the only set shown. */
export function setRemoval(index: number, dbSets: number, s: SetSession): "delete" | "skip" | null {
  if (shownSetCount(dbSets, s) <= 1) return null;
  return setKindAt(index, dbSets, s) === "added" ? "delete" : "skip";
}

/**
 * A skip never hides a set that has numbers on it: when a logged set sits in
 * the slots a skip would hide (an undo from the card's ⋯, another phone
 * logging it), the skip gives way. Returns the session to keep.
 */
export function withLoggedShown(dbSets: number, s: SetSession, highestLogged: number): SetSession {
  const sets = Math.max(1, Number(dbSets) || 1);
  if (!s.skipped) return s;
  const room = Math.max(0, sets - Math.max(0, Math.floor(highestLogged)));
  return s.skipped > room ? { ...s, skipped: room } : s;
}

/**
 * + Add set: a set skipped today comes back first (nothing written: it's the
 * program's), else a new one is added and the program's count is remembered.
 */
export function afterAdd(dbSets: number, s: SetSession): { session: SetSession; write: boolean } {
  const sets = Math.max(1, Number(dbSets) || 1);
  if (skippedSets(sets, s) > 0) return { session: { ...s, skipped: skippedSets(sets, s) - 1 }, write: false };
  return { session: { ...s, planned: s.planned ?? sets }, write: true };
}

/** A set taken out: an added one leaves `planned` as it is (the row's count goes down), a skip counts one more. */
export function afterRemove(kind: "delete" | "skip", dbSets: number, s: SetSession): SetSession {
  if (kind === "delete") return s;
  return { ...s, planned: s.planned ?? Math.max(1, Number(dbSets) || 1), skipped: skippedSets(dbSets, s) + 1 };
}

/**
 * Each row as the workout's progress should count it: its sets less the ones
 * skipped today, so the ring, the Focus bars and the finish review read
 * "nothing left" once every set still on screen is logged.
 */
export function rowsWithSkips<R extends { id: string | number; sets?: number | string | null }>(
  rows: R[],
  sessionOf: (rowId: string) => SetSession,
): R[] {
  let changed = false;
  const out = rows.map((r) => {
    const s = sessionOf(String(r.id));
    if (!s.skipped) return r;
    const sets = Math.max(1, Number(r.sets) || 1);
    const shown = shownSetCount(sets, s);
    if (shown === sets) return r;
    changed = true;
    return { ...r, sets: shown };
  });
  return changed ? out : rows;
}

// ── the writes ──────────────────────────────────────────────────────────

/**
 * Taking set `setIndex` out of a card's logged sets: its row goes (when it
 * has one) and every later row moves down one number, lowest first, so no two
 * rows ever share a number on the way (pl_row_results is unique per client,
 * row and set number). Rows move by id, so whatever hangs off a set (its
 * video) moves with it.
 */
export function takeOutWrites(
  results: ReadonlyArray<{ id: string; set_index: number | string }>,
  setIndex: number,
): { removedId: string | null; shifts: Array<{ id: string; from: number; to: number }> } {
  const removed = results.find((r) => Number(r.set_index) === setIndex) ?? null;
  const shifts = results
    .filter((r) => Number(r.set_index) > setIndex)
    .map((r) => ({ id: String(r.id), from: Number(r.set_index), to: Number(r.set_index) - 1 }))
    .sort((a, b) => a.from - b.from);
  return { removedId: removed ? String(removed.id) : null, shifts };
}

/** Undo: the moved rows go back up, highest first (again never two on one number); then the removed one returns. */
export function putBackWrites(shifts: ReadonlyArray<{ id: string; from: number }>): Array<{ id: string; to: number }> {
  return [...shifts].sort((a, b) => b.from - a.from).map((s) => ({ id: s.id, to: s.from }));
}

// ── the store ───────────────────────────────────────────────────────────

/** Kept this long on the phone: a workout is logged over hours, not days. */
export const SET_SESSION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PREFIX = "jf-set-session:v1:";

const memory = new Map<string, SetSession>();
const listeners = new Set<() => void>();
let version = 0;

const storeKey = (scope: string, rowId: string) => `${PREFIX}${scope}:${rowId}`;

function readStored(key: string): SetSession | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { planned?: unknown; skipped?: unknown; at?: unknown };
    if (typeof v.at !== "number" || Date.now() - v.at > SET_SESSION_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    const planned = typeof v.planned === "number" && v.planned >= 1 ? Math.floor(v.planned) : null;
    const skipped = typeof v.skipped === "number" && v.skipped > 0 ? Math.floor(v.skipped) : 0;
    return { planned, skipped };
  } catch {
    return null;
  }
}

/** This workout's record for a card (`scope` = client and workout instance). */
export function getSetSession(scope: string | null, rowId: string): SetSession {
  if (!scope) return EMPTY_SET_SESSION;
  const key = storeKey(scope, rowId);
  const hit = memory.get(key);
  if (hit) return hit;
  const stored = typeof window === "undefined" ? null : readStored(key);
  const value = stored ?? EMPTY_SET_SESSION;
  memory.set(key, value);
  return value;
}

export function setSetSession(scope: string | null, rowId: string, next: SetSession) {
  if (!scope) return;
  const key = storeKey(scope, rowId);
  const value: SetSession = { planned: next.planned ?? null, skipped: Math.max(0, Math.floor(next.skipped)) };
  memory.set(key, value);
  try {
    if (value.planned == null && value.skipped === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ ...value, at: Date.now() }));
  } catch {
    // private mode / storage full: it still holds for this visit
  }
  version += 1;
  for (const l of listeners) l();
}

export function subscribeSetSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Bumps on every change (useSyncExternalStore's snapshot). */
export function setSessionsVersion(): number {
  return version;
}

/** Test seam. */
export function clearSetSessions() {
  memory.clear();
  version += 1;
}
