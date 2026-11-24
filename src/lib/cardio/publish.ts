/**
 * Publishing a cardio plan (Nov 23 2026): what has to happen to the client's
 * `cardio_targets` rows for the plan they're on from a date to be the coach's
 * draft. Pure; the server applies the writes (cardio-workspace.server.ts).
 *
 * History is kept by dates, never by overwriting: a session that changes ends
 * the day before the change and a new row starts on it, so every week of
 * analytics reads the prescription that was really in force, and a logged
 * session keeps pointing at what it was logged against. A row that never went
 * live (it starts on or after the change) is simply rewritten or removed.
 *
 * Effective today: the new rows start today (today's completion moves with
 * the session). A later date: the plan in force until then is untouched and
 * the new rows wait for their date (program_cardio_sync and the client's day
 * resolver both read a row only on the dates it covers). One change waits at
 * a time: publishing again first undoes the change still waiting (`pending`).
 */
import { addDays } from "@/lib/weight-management/units";
import type { SpeedUnit } from "@/lib/weight-management/units";
import { diffPlans, rowFields, sessionFromRow, type CardioPlan, type CardioSession, type PlanContext, type SessionChange } from "@/lib/cardio/plan";

export type TargetRow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  status?: string | null;
  program_name?: string | null;
  enabled?: boolean | null;
  visible_to_client?: boolean | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a cardio_targets row: every other column, as stored
  [k: string]: any;
};

/** A scheduled change still waiting for its date: the rows it made and the end dates it set. */
export type PendingChange = { versionId: string; createdIds: string[]; closes: Array<{ id: string; prevEnd: string | null }> };

/** The rows that make up the plan (a multi-week cardio program, and anything archived, are their own thing). */
export function planRows<T extends TargetRow>(rows: T[]): T[] {
  return rows.filter((r) => !r.program_name && (r.status ?? "Active") !== "Archived");
}

/** The rows in force on a date. */
export function rowsOn<T extends TargetRow>(rows: T[], date: string): T[] {
  return planRows(rows).filter((r) => (!r.start_date || r.start_date <= date) && (!r.end_date || r.end_date >= date));
}

const enabledOf = (r: TargetRow) => r.enabled !== false && r.visible_to_client !== false;

/** The plan in force on a date, as sessions (oldest row first so the order is stable). */
export function planOn(rows: TargetRow[], date: string): CardioPlan {
  const list = rowsOn(rows, date)
    .slice()
    .sort((a, b) => String(a.start_date ?? "").localeCompare(String(b.start_date ?? "")) || String(a.id).localeCompare(String(b.id)));
  return { sessions: list.map((r) => ({ ...sessionFromRow(r as any), enabled: enabledOf(r) })) };
}

/** The first date after today a waiting change starts on, if one is waiting. */
export function pendingStart(rows: TargetRow[], today: string): string | null {
  const starts = planRows(rows)
    .map((r) => r.start_date)
    .filter((d): d is string => !!d && d > today)
    .sort();
  return starts[0] ?? null;
}

/** The rows as they'd be with the waiting change taken back. */
export function withoutPending<T extends TargetRow>(rows: T[], pending: PendingChange | null): T[] {
  if (!pending) return rows;
  const gone = new Set(pending.createdIds);
  const ends = new Map(pending.closes.map((c) => [c.id, c.prevEnd]));
  return rows.filter((r) => !gone.has(r.id)).map((r) => (ends.has(r.id) ? { ...r, end_date: ends.get(r.id) ?? null } : r));
}

export type PublishOps = {
  effective: string;
  scheduled: boolean;
  /** Take back a change still waiting: its rows go, the end dates it set are put back. */
  revert: { deleteIds: string[]; restore: Array<{ id: string; end_date: string | null }> };
  /** Rewrite a row that hasn't gone live yet (or only its private note). */
  update: Array<{ id: string; key: string; fields: Record<string, unknown> }>;
  /** A new row from the effective date (replacing `replaces` when the session changed). */
  insert: Array<{ key: string; fields: Record<string, unknown>; start_date: string; replaces: string | null }>;
  /** End a row the day before the change; `prevEnd` is kept so a waiting change can be taken back. */
  end: Array<{ id: string; end_date: string; prevEnd: string | null }>;
  /** Rows that never went live and aren't wanted. */
  remove: string[];
  changes: SessionChange[];
};

/**
 * The writes that make the plan in force from `effective` the draft. `today` is the client's own day.
 * A date in the past is today (a change never rewrites what already happened).
 */
export function publishOps(input: {
  rows: TargetRow[];
  draft: CardioPlan;
  today: string;
  effective: string | null;
  ctx: PlanContext;
  unit: SpeedUnit;
  pending: PendingChange | null;
}): PublishOps {
  const effective = input.effective && input.effective > input.today ? input.effective : input.today;
  const pending = input.pending;
  const rows = withoutPending(input.rows, pending);
  const inForce = rowsOn(rows, effective);
  const byId = new Map(inForce.map((r) => [r.id, r]));
  const base = planOn(rows, effective);
  const changes = diffPlans(base, input.draft, input.ctx, input.unit);
  const dayBefore = addDays(effective, -1);
  const ops: PublishOps = {
    effective,
    scheduled: effective > input.today,
    revert: pending
      ? { deleteIds: [...pending.createdIds], restore: pending.closes.map((c) => ({ id: c.id, end_date: c.prevEnd })) }
      : { deleteIds: [], restore: [] },
    update: [],
    insert: [],
    end: [],
    remove: [],
    changes,
  };
  const fields = (s: CardioSession) => ({
    ...rowFields(s, input.ctx, input.unit),
    visible_to_client: s.enabled,
  });
  for (const c of changes) {
    if (c.kind === "added") {
      ops.insert.push({ key: c.key, fields: fields(c.after), start_date: effective, replaces: null });
      continue;
    }
    const row = byId.get((c.kind === "removed" ? c.before.id : c.before.id) ?? "") ?? null;
    if (!row) {
      // a session the base had no row for can't happen; treat a change as an add
      if (c.kind === "changed") ops.insert.push({ key: c.key, fields: fields(c.after), start_date: effective, replaces: null });
      continue;
    }
    const notLiveYet = !!row.start_date && row.start_date >= effective;
    if (c.kind === "note") {
      ops.update.push({ id: row.id, key: c.key, fields: { admin_notes: c.after.coachNote.trim() || null } });
    } else if (c.kind === "removed") {
      if (notLiveYet) ops.remove.push(row.id);
      else ops.end.push({ id: row.id, end_date: dayBefore, prevEnd: row.end_date ?? null });
    } else if (notLiveYet) {
      ops.update.push({ id: row.id, key: c.key, fields: fields(c.after) });
    } else {
      ops.end.push({ id: row.id, end_date: dayBefore, prevEnd: row.end_date ?? null });
      ops.insert.push({ key: c.key, fields: fields(c.after), start_date: effective, replaces: row.id });
    }
  }
  return ops;
}

/** Nothing to write (the draft is the plan in force, notes included). */
export function opsEmpty(ops: PublishOps): boolean {
  return !ops.update.length && !ops.insert.length && !ops.end.length && !ops.remove.length && !ops.revert.deleteIds.length && !ops.revert.restore.length;
}
