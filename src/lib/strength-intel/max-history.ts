/**
 * The coach's reference maxes kept traceable and reversible (pure, tested in
 * strength-intel.test.ts). Three moves, each one row in `pl_client_maxes` and
 * each written to `pl_client_max_history` by the database:
 *
 *  - Pin: the competition lift's current estimate stored as its Est. 1RM, so a
 *    "% of Est. 1RM" stops moving with their training until it's unpinned
 *    (computeRowLoad reads a stored e1RM before the live one).
 *  - Lock for a block: the reference as it stands today (the coach's 1RM and
 *    TM, and the estimate) copied onto a row for that block only, so nothing
 *    changes mid-block (buildMaxIndex: a block's row wins). Unlock removes it.
 *  - Restore: any earlier version put back (an add undone, a change or a
 *    removal reversed), as a new change of its own, never a rewrite of history.
 *
 * Nothing here decides a number: the estimate comes from the strength read
 * (planning.ts), the coach's numbers from their rows.
 */
import { competitionMax } from "@/lib/workouts/load-reference";
import { LB_PER_KG } from "./rules";
import type { LiftFamily, PlanningRef } from "./planning";

type Unit = "kg" | "lb";

export type MaxRowLike = {
  id?: string;
  lift: string;
  block_id?: string | null;
  one_rm?: number | null;
  training_max?: number | null;
  estimated_1rm?: number | null;
  unit?: Unit | string | null;
  notes?: string | null;
  source?: string | null;
  tested_at?: string | null;
  active?: boolean | null;
  rounding_step?: number | null;
  rounding_mode?: string | null;
  source_lift?: string | null;
  variation_modifier?: number | null;
  manual_override?: boolean | null;
  exercise_id?: string | null;
  source_exercise_id?: string | null;
};

export type MaxHistoryEntry = {
  id: string;
  max_id: string;
  client_id: string;
  op: "insert" | "update" | "delete";
  before: MaxRowLike | null;
  after: MaxRowLike | null;
  changed_by: string | null;
  changed_at: string;
};

/** The columns a restore writes back (never ids or timestamps). */
export const RESTORE_FIELDS = [
  "lift",
  "block_id",
  "one_rm",
  "training_max",
  "estimated_1rm",
  "unit",
  "notes",
  "source",
  "tested_at",
  "active",
  "rounding_step",
  "rounding_mode",
  "source_lift",
  "variation_modifier",
  "manual_override",
  "exercise_id",
  "source_exercise_id",
] as const;

export const COMPETITION_MAX_NAME: Record<LiftFamily, string> = {
  squat: "Competition Squat",
  bench: "Competition Bench Press",
  deadlift: "Competition Deadlift",
};

/** An estimate's precision in a max row: half a kilo or a pound. */
export function estimateIn(kg: number, unit: Unit): number {
  return unit === "kg" ? Math.round(kg * 2) / 2 : Math.round(kg * LB_PER_KG);
}

const unitOf = (u: unknown): Unit => (u === "lb" ? "lb" : "kg");

/** The global (profile) row a competition lift's reference lives on, or null. */
export function profileRow<T extends MaxRowLike>(rows: T[], family: LiftFamily): T | null {
  return competitionMax(
    rows.filter((r) => !r.block_id),
    family,
  );
}

/** The block's own row for a competition lift, or null. */
export function blockRow<T extends MaxRowLike>(rows: T[], family: LiftFamily, blockId: string): T | null {
  return competitionMax(
    rows.filter((r) => r.block_id === blockId),
    family,
  );
}

const pinNote = (ref: PlanningRef, day: string) =>
  `Est. 1RM pinned from the strength read on ${day} (${ref.word ?? "low"} confidence${ref.lowerBound ? ", a lower bound" : ""}).`;

/**
 * Pin the current estimate as the lift's Est. 1RM on their profile row (made
 * when there's none). In the row's own unit; its 1RM and TM untouched.
 */
export function pinWrite(rows: MaxRowLike[], family: LiftFamily, ref: PlanningRef, day: string, fallbackUnit: Unit) {
  const row = profileRow(rows, family);
  const unit = unitOf(row?.unit ?? fallbackUnit);
  return {
    lift: row?.lift ?? COMPETITION_MAX_NAME[family],
    block_id: null,
    unit,
    estimated_1rm: estimateIn(ref.kg, unit),
    notes: pinNote(ref, day),
    active: true,
    ...(row ? {} : { source: "estimated", rounding_mode: "nearest", rounding_step: unit === "kg" ? 2.5 : 5 }),
  };
}

/**
 * Unpin: the lift's Est. 1RM cleared so a % of it reads the live estimate
 * again. A row that held nothing else is removed instead (it only existed for
 * the pin); the history keeps both.
 */
export function unpinWrite(row: MaxRowLike): { kind: "delete"; id: string } | { kind: "put"; row: MaxRowLike } | null {
  if (!row.id || row.estimated_1rm == null) return null;
  const holdsMore = row.one_rm != null || row.training_max != null || !!row.source_lift || !!row.source_exercise_id;
  if (!holdsMore) return { kind: "delete", id: row.id };
  const notes = row.notes && /^Est\. 1RM pinned/.test(row.notes) ? null : (row.notes ?? null);
  return { kind: "put", row: { lift: row.lift, block_id: row.block_id ?? null, estimated_1rm: null, notes } };
}

/**
 * Lock a competition lift's reference for one block: the coach's 1RM and TM
 * as they are on the profile today, and the current estimate (when there's one
 * a program can read) as its Est. 1RM, on a row for that block only.
 */
export function lockWrite(rows: MaxRowLike[], family: LiftFamily, blockId: string, ref: PlanningRef | null, day: string, fallbackUnit: Unit) {
  const prof = profileRow(rows, family);
  const unit = unitOf(prof?.unit ?? fallbackUnit);
  const estimate = prof?.estimated_1rm ?? (ref ? estimateIn(ref.kg, unit) : null);
  return {
    lift: prof?.lift ?? COMPETITION_MAX_NAME[family],
    block_id: blockId,
    unit,
    one_rm: prof?.one_rm ?? null,
    training_max: prof?.training_max ?? null,
    estimated_1rm: estimate,
    source: prof?.source ?? "estimated",
    tested_at: prof?.tested_at ?? null,
    rounding_step: prof?.rounding_step ?? (unit === "kg" ? 2.5 : 5),
    rounding_mode: prof?.rounding_mode ?? "nearest",
    active: true,
    notes: `Locked for this block on ${day}${prof?.estimated_1rm == null && ref ? ` (Est. 1RM from the strength read, ${ref.word ?? "low"} confidence)` : ""}.`,
  };
}

/** Put back the version before a change: an add undone, a change or removal reversed. */
export function restoreWrite(e: MaxHistoryEntry): { kind: "delete"; id: string } | { kind: "put"; id: string | null; row: MaxRowLike } | null {
  if (e.op === "insert") return { kind: "delete", id: e.max_id };
  const b = e.before;
  if (!b) return null;
  const row: MaxRowLike = { lift: b.lift };
  for (const k of RESTORE_FIELDS) (row as any)[k] = (b as any)[k] ?? null;
  if (row.active == null) row.active = true;
  if (row.manual_override == null) row.manual_override = false;
  return { kind: "put", id: e.op === "update" ? e.max_id : null, row };
}

const num = (v: unknown, unit: string) => (v == null || v === "" ? null : `${Math.round(Number(v) * 100) / 100} ${unit}`);
const NUMBERS: [keyof MaxRowLike, string][] = [
  ["one_rm", "1RM"],
  ["training_max", "TM"],
  ["estimated_1rm", "Est. 1RM"],
];

/** One change in plain words: "1RM 230 → 235 kg", "Est. 1RM pinned at 157.5 kg", "Removed (TM 180 kg)". */
export function historyLine(e: MaxHistoryEntry): string {
  const row = (e.after ?? e.before) as MaxRowLike;
  const unit = unitOf(row?.unit);
  const values = (r: MaxRowLike | null) =>
    NUMBERS.map(([k, label]) => (r && r[k] != null ? `${label} ${num(r[k], unitOf(r.unit))}` : null))
      .filter(Boolean)
      .join(", ");
  if (e.op === "insert") return `Added${values(e.after) ? `: ${values(e.after)}` : ""}`;
  if (e.op === "delete") return `Removed${values(e.before) ? ` (${values(e.before)})` : ""}`;
  const parts: string[] = [];
  const b = e.before ?? ({} as MaxRowLike);
  const a = e.after ?? ({} as MaxRowLike);
  for (const [k, label] of NUMBERS) {
    const from = b[k] ?? null;
    const to = a[k] ?? null;
    if (from === to || Number(from) === Number(to)) continue;
    if (to == null) parts.push(`${label} ${num(from, unitOf(b.unit))} cleared`);
    else if (from == null) parts.push(`${label} set to ${num(to, unit)}`);
    else parts.push(`${label} ${Math.round(Number(from) * 100) / 100} → ${num(to, unit)}`);
  }
  if (unitOf(b.unit) !== unitOf(a.unit)) parts.push(`unit ${unitOf(b.unit)} → ${unitOf(a.unit)}`);
  if (b.active !== a.active) parts.push(a.active ? "made active" : "made inactive");
  if ((b.lift ?? "") !== (a.lift ?? "")) parts.push(`renamed from ${b.lift}`);
  return parts.length ? parts.join(", ") : "Details changed";
}

/** One change as `pl_client_max_changes_since` hands it over: only what a load is worked out from. */
export type MaxChange = {
  max_id: string;
  op: "insert" | "update" | "delete";
  before: MaxRowLike | null;
  after: MaxRowLike | null;
  changed_at: string;
};

/**
 * The maxes as they stood at `at` (a finished workout's moment), so its % loads
 * read what was planned rather than what the coach changed since: every max
 * changed later is put back to how its first later change found it, one added
 * later is left out, one removed later comes back. History starts on Nov 26
 * 2026: changes before that weren't kept, so an older workout reads the maxes as
 * they were then onward.
 */
export function maxesAsOf<T extends MaxRowLike & { id: string }>(current: T[], changes: MaxChange[], at: string): T[] {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || !changes.length) return current;
  const later = changes
    .map((c, i) => ({ c, i, ts: Date.parse(c.changed_at) }))
    .filter((x) => Number.isFinite(x.ts) && x.ts > t)
    .sort((a, b) => a.ts - b.ts || a.i - b.i);
  const firstAfter = new Map<string, MaxChange>();
  for (const { c } of later) if (!firstAfter.has(c.max_id)) firstAfter.set(c.max_id, c);
  if (!firstAfter.size) return current;
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of current) {
    seen.add(row.id);
    const c = firstAfter.get(row.id);
    if (!c) out.push(row);
    else if (c.op !== "insert" && c.before) out.push({ ...row, ...c.before, id: row.id } as T);
  }
  for (const [id, c] of firstAfter) {
    if (seen.has(id) || c.op === "insert" || !c.before) continue;
    out.push({ ...(c.before as object), id } as T);
  }
  return out;
}

/**
 * A running block kept on a max as it was before the coach changed it: the old
 * numbers copied onto a row for that block only (buildMaxIndex: a block's row
 * wins), so the block's % loads don't move mid-block.
 */
export function keepBlockOnRow(old: MaxRowLike, blockId: string, day: string): MaxRowLike {
  const row: MaxRowLike = { lift: old.lift };
  for (const k of RESTORE_FIELDS) (row as any)[k] = (old as any)[k] ?? null;
  row.block_id = blockId;
  row.active = true;
  if (row.manual_override == null) row.manual_override = false;
  row.notes = `Kept on the earlier numbers for this block when the max changed on ${day}.`;
  return row;
}
