/**
 * Undo / redo / reset for one exercise card in a workout.
 *
 * Snapshot-based: a card's state is its logged sets (pl_row_results for this
 * row and workout), its set count and its warm-ups. Every settled change the
 * athlete makes becomes a step; undo/redo write a snapshot back. Reset is a
 * step too (nothing logged, the set count the card opened with), so it can be
 * undone. Pure: the workout view does the reads and writes.
 */

/** Columns a set is restored with (normalized kg/lb are recomputed by the DB trigger). */
export const SET_FIELDS = [
  "actual_load",
  "actual_load_unit",
  "entered_value",
  "entered_unit",
  "actual_reps",
  "actual_rpe",
  "actual_rpe_num",
  "actual_rir",
  "notes",
  "video_url",
  "completed_at",
  "completed_duration_seconds",
  "is_working_set",
  "timer_started_at",
  "timer_completed_at",
  "completion_method",
  "is_bodyweight",
  "load_type",
  "mean_concentric_velocity_mps",
] as const;
type SetField = (typeof SET_FIELDS)[number];

const NUMERIC = new Set<SetField>(["actual_load", "entered_value", "actual_reps", "actual_rpe_num", "actual_rir", "completed_duration_seconds", "mean_concentric_velocity_mps"]);
const TIMESTAMP = new Set<SetField>(["completed_at", "timer_started_at", "timer_completed_at"]);
/** NOT NULL columns: a missing value means the column default. */
const DEFAULTS: Partial<Record<SetField, string | boolean>> = { is_bodyweight: false, load_type: "external" };

export type CardSet = { set_index: number } & Record<SetField, string | number | boolean | null>;
export type CardWarmup = { load: number; unit: string; reps: number; rpe: number | null };
export type CardSnapshot = { setCount: number; sets: CardSet[]; warmups: CardWarmup[] };
type Row = Record<string, unknown>;

/**
 * Normalized so the same state always looks the same: numbers as numbers,
 * timestamps as epoch ms (the optimistic cache and the server format them
 * differently), missing as null (or the column default).
 */
export function snapshotOf(
  results: Row[],
  setCount: number,
  warmups: ReadonlyArray<{ load: unknown; unit: unknown; reps: unknown; rpe?: unknown }> = [],
): CardSnapshot {
  const sets = results
    .filter((r) => r && Number.isFinite(Number(r.set_index)))
    .map((r) => {
      const s: Record<string, unknown> = { set_index: Number(r.set_index) };
      for (const f of SET_FIELDS) {
        const v = r[f];
        if (v == null || v === "") s[f] = DEFAULTS[f] ?? null;
        else if (NUMERIC.has(f)) s[f] = Number.isFinite(Number(v)) ? Number(v) : null;
        else if (TIMESTAMP.has(f)) s[f] = Number.isFinite(Date.parse(String(v))) ? Date.parse(String(v)) : null;
        else s[f] = v;
      }
      return s as CardSet;
    })
    .sort((a, b) => a.set_index - b.set_index);
  const w = warmups
    .map((x) => ({ load: Number(x.load), unit: String(x.unit), reps: Number(x.reps), rpe: x.rpe == null ? null : Number(x.rpe) }))
    .filter((x) => x.load > 0 && x.reps > 0);
  return { setCount: Math.max(1, Number(setCount) || 1), sets, warmups: w };
}

/**
 * What the athlete can see: weight, reps, RPE, done or not, time, velocity.
 * Steps are told apart by this, so server bookkeeping (a completion
 * timestamp's precision, a default filled in) never makes an undo that
 * appears to do nothing.
 */
export function snapshotKey(s: CardSnapshot): string {
  return JSON.stringify([
    s.setCount,
    s.sets.map((x) => [
      x.set_index,
      x.entered_value ?? x.actual_load,
      x.entered_unit ?? x.actual_load_unit,
      x.actual_reps,
      x.actual_rpe_num ?? x.actual_rpe,
      x.completed_at != null,
      x.completed_duration_seconds,
      x.mean_concentric_velocity_mps,
      x.load_type,
    ]),
    s.warmups,
  ]);
}

/** Nothing logged on the card (sets or warm-ups). */
export const isBlank = (s: CardSnapshot) => s.sets.length === 0 && s.warmups.length === 0;

export type CardHistory = { past: CardSnapshot[]; present: CardSnapshot | null; future: CardSnapshot[] };
export const HISTORY_LIMIT = 25;
export const EMPTY_HISTORY: CardHistory = { past: [], present: null, future: [] };

/** A settled change: the old present becomes undoable, redo is cleared. */
export function record(h: CardHistory, next: CardSnapshot): CardHistory {
  if (!h.present) return { ...h, present: next };
  if (snapshotKey(h.present) === snapshotKey(next)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function stepBack(h: CardHistory): { history: CardHistory; target: CardSnapshot } | null {
  if (!h.present || h.past.length === 0) return null;
  const target = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), present: target, future: [h.present, ...h.future] }, target };
}

export function stepForward(h: CardHistory): { history: CardHistory; target: CardSnapshot } | null {
  if (!h.present || h.future.length === 0) return null;
  const target = h.future[0];
  return { history: { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: target, future: h.future.slice(1) }, target };
}

/** Reset: nothing logged, the set count the card opened with. */
export function resetTarget(originalSetCount: number): CardSnapshot {
  return { setCount: Math.max(1, Number(originalSetCount) || 1), sets: [], warmups: [] };
}

/** Is there anything for Reset to clear? */
export const canResetTo = (current: CardSnapshot, originalSetCount: number) =>
  snapshotKey(current) !== snapshotKey(resetTarget(originalSetCount));

/**
 * The writes that turn the card's current rows into `target`: rows to upsert
 * (by set index, keeping the existing id), rows to delete, the set count and
 * the warm-ups (null = leave as they are).
 */
export function planRestore(
  currentRows: Array<{ id: string; set_index: number }>,
  current: CardSnapshot,
  target: CardSnapshot,
): {
  upserts: Array<{ id: string | null; set: CardSet }>;
  deletes: string[];
  setCount: number | null;
  warmups: CardWarmup[] | null;
} {
  const want = new Map(target.sets.map((s) => [s.set_index, s]));
  const have = new Map(current.sets.map((s) => [s.set_index, s]));
  const upserts: Array<{ id: string | null; set: CardSet }> = [];
  for (const [index, set] of want) {
    const now = have.get(index);
    if (now && JSON.stringify(now) === JSON.stringify(set)) continue;
    upserts.push({ id: currentRows.find((r) => Number(r.set_index) === index)?.id ?? null, set });
  }
  const deletes = currentRows.filter((r) => !want.has(Number(r.set_index))).map((r) => r.id);
  return {
    upserts,
    deletes,
    setCount: current.setCount === target.setCount ? null : target.setCount,
    warmups: JSON.stringify(current.warmups) === JSON.stringify(target.warmups) ? null : target.warmups,
  };
}

/** A set's stored columns from a snapshot (timestamps back to ISO). */
export function setPayload(set: CardSet): Record<string, unknown> {
  const out: Record<string, unknown> = { set_index: set.set_index };
  for (const f of SET_FIELDS) {
    const v = set[f];
    out[f] = TIMESTAMP.has(f) && typeof v === "number" ? new Date(v).toISOString() : v ?? DEFAULTS[f] ?? null;
  }
  return out;
}
