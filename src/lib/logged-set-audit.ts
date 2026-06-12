import { supabase } from "@/integrations/supabase/client";

/**
 * Diff a logged set's previous vs new values and write one audit row per
 * changed field to `public.logged_set_edit_audit`. Used by coach/admin POV
 * edits of `pl_row_results` (and member_set_logs). No-op when nothing
 * actually changed, when not impersonating, or when the editor user id is
 * unknown. Failures are swallowed (audit must never block the save itself).
 */
export type AuditContext = {
  setLogId: string | null;
  clientId: string;
  workoutId?: string | null;
  enrollmentId?: string | null;
  programId?: string | null;
  exerciseId?: string | null;
  exerciseName?: string | null;
  editedByUserId: string;
  editedByRole?: "coach" | "admin" | "coach_pov" | string;
  editSource?: string;
  pageRoute?: string | null;
  reason?: string | null;
};

type Snapshot = {
  weight?: string | number | null;
  reps?: string | number | null;
  rpe?: string | number | null;
  status?: string | null;
  unit?: string | null;
  notes?: string | null;
};

function asStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

export async function writeSetEditAudit(
  before: Snapshot,
  after: Snapshot,
  ctx: AuditContext,
): Promise<void> {
  if (!ctx.editedByUserId || !ctx.clientId) return;
  const fields: (keyof Snapshot)[] = ["weight", "reps", "rpe", "status", "unit", "notes"];
  const rows: any[] = [];
  for (const f of fields) {
    const a = asStr(before[f]);
    const b = asStr(after[f]);
    if (a === b) continue;
    rows.push({
      set_log_id: ctx.setLogId,
      client_id: ctx.clientId,
      workout_id: ctx.workoutId ?? null,
      enrollment_id: ctx.enrollmentId ?? null,
      program_id: ctx.programId ?? null,
      exercise_id: ctx.exerciseId ?? null,
      exercise_name: ctx.exerciseName ?? null,
      field_changed: f,
      previous_value: a,
      new_value: b,
      edited_by_user_id: ctx.editedByUserId,
      edited_by_role: ctx.editedByRole ?? "coach_pov",
      edit_source: ctx.editSource ?? "coach_pov",
      reason: ctx.reason ?? null,
      page_route: ctx.pageRoute ?? null,
    });
  }
  if (!rows.length) return;
  try {
    await (supabase as any).from("logged_set_edit_audit").insert(rows);
  } catch {
    // Audit must never block the save.
  }
}