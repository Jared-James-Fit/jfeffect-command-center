/**
 * At-Home Backup Workouts — shared, side-effect-free helpers.
 *
 * Architecture (canonical coaching pipeline, no new tables):
 *   pl_blocks -> pl_weeks -> pl_days -> pl_exercise_rows
 *   pl_day_completions -> pl_row_results
 *
 * Two client-owned blocks, identified by `source_template_block_key`:
 *   1. Definitions  (`at_home_backup_definitions_v1`) — client_visible = false.
 *      Coach-owned reusable templates ("Holds Full Body A / B / C").
 *      Read only through the server function (privileged read after the
 *      caller is authorized), never by the browser client.
 *   2. Sessions     (`at_home_backup_sessions_v1`) — instantiated dated days.
 *      NOTE (deliberate deviation, documented): this block is client_visible
 *      so the EXISTING logger, calendar and history keep working through the
 *      existing RLS policies, which gate pl_days / pl_exercise_rows /
 *      pl_row_results reads on `pl_blocks.client_visible`. Making it private
 *      would have required changing shared RLS for every client, which is
 *      out of scope for this feature. Adherence semantics are unchanged;
 *      backup sessions are tagged distinctly in the UI instead.
 */

export const AT_HOME_BACKUP_DEFINITIONS_KEY = "at_home_backup_definitions_v1";
export const AT_HOME_BACKUP_SESSIONS_KEY = "at_home_backup_sessions_v1";

/**
 * Both reserved block keys. Neither block may take part in primary program
 * selection, the Schedule Manager, the primary calendar query, Block View, or
 * any adherence numerator/denominator.
 */
export const RESERVED_AT_HOME_BACKUP_BLOCK_KEYS: readonly string[] = [
  AT_HOME_BACKUP_DEFINITIONS_KEY,
  AT_HOME_BACKUP_SESSIONS_KEY,
];

export const AT_HOME_BACKUP_BADGE = "At-home backup";
export const AT_HOME_BACKUP_SUBTITLE = "At-home backup";
export const AT_HOME_BACKUP_CALENDAR_BADGE = "AT HOME";

/** Exact confirmation copy for "start a backup on a normal gym day". */
export const AT_HOME_BACKUP_CONFIRM_TITLE = "Use this as today's backup?";
export const AT_HOME_BACKUP_CONFIRM_BODY =
  "Your scheduled gym workout will stay on your program.";
export const AT_HOME_BACKUP_CONFIRM_ACCEPT = "Use Backup";
export const AT_HOME_BACKUP_CONFIRM_CANCEL = "Cancel";

/** Confirmation shows only when a normal gym session is scheduled today. */
export function shouldConfirmBackupStart(hasPrimaryWorkoutToday: boolean): boolean {
  return !!hasPrimaryWorkoutToday;
}

export const AT_HOME_BACKUP_DEFINITIONS_BLOCK_NAME = "At-Home Backup — Definitions";
export const AT_HOME_BACKUP_SESSIONS_BLOCK_NAME = "At-Home Backup — Sessions";

/**
 * Scoped rollout: only these clients see the At-Home Backup entry point.
 * (Ashley Santos.)
 */
export const AT_HOME_BACKUP_CLIENT_IDS: readonly string[] = [
  "b970c6db-e59c-45b9-9429-6122b53b8616",
];

export function isAtHomeBackupClient(clientId: string | null | undefined): boolean {
  return !!clientId && AT_HOME_BACKUP_CLIENT_IDS.includes(clientId);
}

/** True when a pl_blocks row is the instantiated-sessions block. */
export function isAtHomeBackupSessionBlock(
  block: { source_template_block_key?: string | null } | null | undefined,
): boolean {
  return block?.source_template_block_key === AT_HOME_BACKUP_SESSIONS_KEY;
}

/** True when a pl_blocks row is the private definitions block. */
export function isAtHomeBackupDefinitionsBlock(
  block: { source_template_block_key?: string | null } | null | undefined,
): boolean {
  return block?.source_template_block_key === AT_HOME_BACKUP_DEFINITIONS_KEY;
}

/** True when a pl_blocks row is either reserved at-home backup block. */
export function isReservedAtHomeBackupBlock(
  block: { source_template_block_key?: string | null } | null | undefined,
): boolean {
  const key = block?.source_template_block_key ?? null;
  return !!key && RESERVED_AT_HOME_BACKUP_BLOCK_KEYS.includes(key);
}

/**
 * Canonical primary-program boundary: drop both reserved blocks.
 * `includeSessions` is the narrow opt-in used only by the Ashley-only
 * backup read path (calendar/history chips); definitions are never included.
 */
export function filterPrimaryProgramBlocks<
  T extends { source_template_block_key?: string | null },
>(blocks: T[] | null | undefined, opts: { includeSessions?: boolean } = {}): T[] {
  return (blocks ?? []).filter((block) => {
    if (isAtHomeBackupDefinitionsBlock(block)) return false;
    if (isAtHomeBackupSessionBlock(block)) return !!opts.includeSessions;
    return true;
  });
}

/**
 * True for either implementation-only At-Home Backup block. Primary program
 * selectors, editor lists, schedule repair, and block analytics must use this
 * predicate rather than assuming client visibility or block status is enough.
 */
export function isAtHomeBackupReservedBlock(
  block: { source_template_block_key?: string | null } | null | undefined,
): boolean {
  return isAtHomeBackupSessionBlock(block) || isAtHomeBackupDefinitionsBlock(block);
}

/** The explicit inclusion rule for canonical primary-program surfaces. */
export function isPrimaryProgramBlock(
  block: { source_template_block_key?: string | null } | null | undefined,
): boolean {
  return !isAtHomeBackupReservedBlock(block);
}

/**
 * Idempotency key for "this definition, started on this date".
 * Used to reuse an existing, not-yet-completed session instead of
 * creating a duplicate when the client double-taps Start.
 */
export function backupSessionDedupeKey(definitionDayId: string, dateISO: string): string {
  return `${definitionDayId}:${dateISO}`;
}

/** Session day title — keeps the definition name so history reads clearly. */
export function backupSessionTitle(definitionTitle: string | null | undefined): string {
  const base = (definitionTitle ?? "").trim();
  return base.length ? base : "At-Home Backup";
}

export type BackupRowPrescription = {
  sort_order: number;
  exercise_id: string | null;
  exercise_name_override: string | null;
  sets: number | null;
  reps_text: string | null;
  rpe: number | null;
  rir: number | null;
  rest_seconds: number | null;
  tempo: string | null;
  notes: string | null;
  measurement_type: string;
  tracking_type: string;
  duration_seconds: number | null;
  purpose_label: string | null;
  time_profile: string;
};

/**
 * Copy only the prescription fields from a definition row onto a new
 * session row. Never copies ids, timestamps, or any logged result.
 */
export function cloneBackupRow(row: any, sortOrder: number): BackupRowPrescription {
  return {
    sort_order: sortOrder,
    exercise_id: row?.exercise_id ?? null,
    exercise_name_override: row?.exercise_name_override ?? null,
    sets: row?.sets ?? null,
    reps_text: row?.reps_text ?? null,
    rpe: row?.rpe ?? null,
    rir: row?.rir ?? null,
    rest_seconds: row?.rest_seconds ?? null,
    tempo: row?.tempo ?? null,
    notes: row?.notes ?? null,
    measurement_type: row?.measurement_type ?? "reps",
    tracking_type: row?.tracking_type ?? (row?.measurement_type === "time" ? "time" : "reps_weight"),
    duration_seconds: row?.duration_seconds ?? null,
    purpose_label: row?.purpose_label ?? null,
    time_profile: row?.time_profile ?? "accessory_compound",
  };
}

/** Compact "5 exercises · ~45 min" style summary for the picker list. */
/** Each Full Body definition must carry exactly seven prescribed rows. */
export const BACKUP_DEFINITION_EXERCISE_COUNT = 7;

/** True when a definition day carries the full prescribed row set. */
export function isCompleteBackupDefinition(rows: unknown[] | null | undefined): boolean {
  return (rows?.length ?? 0) === BACKUP_DEFINITION_EXERCISE_COUNT;
}

export function summarizeBackupDefinition(rows: any[]): string {
  const count = rows.length;
  const totalSets = rows.reduce((sum, r) => sum + (Number(r?.sets) || 0), 0);
  const parts = [`${count} exercise${count === 1 ? "" : "s"}`];
  if (totalSets > 0) parts.push(`${totalSets} sets`);
  return parts.join(" · ");
}