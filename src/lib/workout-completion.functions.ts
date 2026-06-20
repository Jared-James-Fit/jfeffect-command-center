/**
 * Shared workout completion / review server functions.
 *
 * One implementation, two storage backends. Each function accepts a
 * `ctx` discriminated by `kind`:
 *   - kind: "client" → writes pl_day_completions / pl_workout_feedback /
 *           pl_row_results, scoped to clients.id resolved from auth.uid.
 *   - kind: "member" → writes member_workout_completions /
 *           member_workout_reviews / member_set_logs, scoped to the
 *           enrollment owned by auth.uid.
 *
 * All writes are idempotent. Rapid taps, retries, and offline-queue
 * replays update or return the existing record rather than creating
 * duplicates. Idempotency is enforced by the DB unique constraints
 * applied in the Phase 1 migration; this layer uses UPSERTs and explicit
 * existence checks to surface the existing row.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  summarizeCompleteness,
  type LoggedSetSpec,
  type RequiredRowSpec,
} from "./workout-completeness";
import {
  computeElapsedSeconds,
  computeActiveSeconds,
} from "./workout-duration";

/* -------------------------------------------------------------------------- */
/*  Shared schemas                                                            */
/* -------------------------------------------------------------------------- */

const ClientCtx = z.object({
  kind: z.literal("client"),
  dayId: z.string().uuid(),
});
const MemberCtx = z.object({
  kind: z.literal("member"),
  enrollmentId: z.string().uuid(),
  weekIndex: z.number().int().nonnegative(),
  dayIndex: z.number().int().nonnegative(),
});
const Ctx = z.discriminatedUnion("kind", [ClientCtx, MemberCtx]);
type CtxT = z.infer<typeof Ctx>;

/** Resolve clients.id for the signed-in user, throwing if not a client. */
async function resolveClientId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("No client record for current user");
  return data.id as string;
}

/** Ensure the signed-in user owns the enrollment. */
async function assertOwnsEnrollment(supabase: any, enrollmentId: string) {
  const { data, error } = await supabase
    .from("member_plan_enrollments")
    .select("id")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("Enrollment not found or access denied");
}

/* -------------------------------------------------------------------------- */
/*  startWorkout — idempotent "start" upsert                                  */
/* -------------------------------------------------------------------------- */

export const startWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Ctx.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    if (data.kind === "client") {
      const clientId = await resolveClientId(supabase, userId);
      const { data: existing } = await supabase
        .from("pl_day_completions")
        .select("id, started_at, last_activity_at, completed_at")
        .eq("client_id", clientId)
        .eq("day_id", data.dayId)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from("pl_day_completions")
          .update({ last_activity_at: nowIso })
          .eq("id", existing.id);
        return { id: existing.id, started_at: existing.started_at ?? nowIso };
      }
      const { data: inserted, error } = await supabase
        .from("pl_day_completions")
        .upsert(
          {
            client_id: clientId,
            day_id: data.dayId,
            started_at: nowIso,
            in_progress_at: nowIso,
            last_activity_at: nowIso,
            completion_source: "workout_view",
          },
          { onConflict: "client_id,day_id", ignoreDuplicates: false },
        )
        .select("id, started_at")
        .single();
      if (error) throw error;
      return { id: inserted.id, started_at: inserted.started_at };
    }

    await assertOwnsEnrollment(supabase, data.enrollmentId);
    const { data: existing } = await supabase
      .from("member_workout_completions")
      .select("id, started_at, last_activity_at, completed_at")
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .maybeSingle();
    if (existing?.id) {
      await supabase
        .from("member_workout_completions")
        .update({ last_activity_at: nowIso })
        .eq("id", existing.id);
      return { id: existing.id, started_at: existing.started_at ?? nowIso };
    }
    const { data: inserted, error } = await supabase
      .from("member_workout_completions")
      .upsert(
        {
          enrollment_id: data.enrollmentId,
          week_index: data.weekIndex,
          day_index: data.dayIndex,
          started_at: nowIso,
          in_progress_at: nowIso,
          last_activity_at: nowIso,
          completion_source: "workout_view",
          completed_at: null,
        },
        { onConflict: "enrollment_id,week_index,day_index", ignoreDuplicates: false },
      )
      .select("id, started_at")
      .single();
    if (error) throw error;
    return { id: inserted.id, started_at: inserted.started_at };
  });

/* -------------------------------------------------------------------------- */
/*  updateWorkoutActivity — heartbeat last_activity_at                        */
/* -------------------------------------------------------------------------- */

export const updateWorkoutActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Ctx.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    if (data.kind === "client") {
      const clientId = await resolveClientId(supabase, userId);
      await supabase
        .from("pl_day_completions")
        .update({ last_activity_at: nowIso })
        .eq("client_id", clientId)
        .eq("day_id", data.dayId)
        .is("completed_at", null);
    } else {
      await assertOwnsEnrollment(supabase, data.enrollmentId);
      await supabase
        .from("member_workout_completions")
        .update({ last_activity_at: nowIso })
        .eq("enrollment_id", data.enrollmentId)
        .eq("week_index", data.weekIndex)
        .eq("day_index", data.dayIndex)
        .is("completed_at", null);
    }
    return { ok: true, last_activity_at: nowIso };
  });

/* -------------------------------------------------------------------------- */
/*  saveSetResult — idempotent upsert by (user, row/exercise, set)            */
/* -------------------------------------------------------------------------- */

const SaveSetInput = z.intersection(
  Ctx,
  z.object({
    setIndex: z.number().int().nonnegative(),
    rowId: z.string().uuid().optional(),         // client
    exerciseIndex: z.number().int().nonnegative().optional(), // member
    reps: z.number().int().nullable().optional(),
    loadLb: z.number().nullable().optional(),
    loadKg: z.number().nullable().optional(),
    rpe: z.union([z.string(), z.number()]).nullable().optional(),
    rir: z.union([z.string(), z.number()]).nullable().optional(),
    isWorkingSet: z.boolean().nullable().optional(),
    notes: z.string().nullable().optional(),
    completedDurationSeconds: z.number().int().nullable().optional(),
  }),
);

export const saveSetResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveSetInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    if (data.kind === "client") {
      if (!data.rowId) throw new Error("rowId required for client kind");
      const clientId = await resolveClientId(supabase, userId);
      const payload: Record<string, any> = {
        client_id: clientId,
        row_id: data.rowId,
        set_index: data.setIndex,
        actual_reps: data.reps ?? null,
        actual_load_lb: data.loadLb ?? null,
        actual_load_kg: data.loadKg ?? null,
        actual_rpe: data.rpe == null ? null : String(data.rpe),
        actual_rir: data.rir == null ? null : String(data.rir),
        is_working_set: data.isWorkingSet ?? null,
        notes: data.notes ?? null,
        completed_duration_seconds: data.completedDurationSeconds ?? null,
        completed_at: nowIso,
      };
      const { data: row, error } = await supabase
        .from("pl_row_results")
        .upsert(payload, { onConflict: "client_id,row_id,set_index" })
        .select("id")
        .single();
      if (error) throw error;
      // heartbeat
      await supabase
        .from("pl_day_completions")
        .update({ last_activity_at: nowIso })
        .eq("client_id", clientId)
        .is("completed_at", null);
      return { id: row.id };
    }

    if (data.exerciseIndex == null) throw new Error("exerciseIndex required for member kind");
    await assertOwnsEnrollment(supabase, data.enrollmentId);
    const payload: Record<string, any> = {
      enrollment_id: data.enrollmentId,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      exercise_index: data.exerciseIndex,
      set_index: data.setIndex,
      reps: data.reps ?? null,
      load_lb: data.loadLb ?? null,
      load_kg: data.loadKg ?? null,
      rpe: data.rpe == null ? null : Number(data.rpe),
      rir: data.rir == null ? null : Number(data.rir),
      is_working_set: data.isWorkingSet ?? null,
      notes: data.notes ?? null,
      completed_duration_seconds: data.completedDurationSeconds ?? null,
      logged_at: nowIso,
    };
    const { data: row, error } = await supabase
      .from("member_set_logs")
      .upsert(payload, {
        onConflict: "enrollment_id,week_index,day_index,exercise_index,set_index",
      })
      .select("id")
      .single();
    if (error) throw error;
    await supabase
      .from("member_workout_completions")
      .update({ last_activity_at: nowIso })
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .is("completed_at", null);
    return { id: row.id };
  });

/* -------------------------------------------------------------------------- */
/*  completeWorkout — idempotent finish                                        */
/* -------------------------------------------------------------------------- */

const RequiredRowSchema = z.object({
  rowId: z.string(),
  prescribedSets: z.number().int().nullable().optional(),
  metricKind: z.enum(["load_reps", "bodyweight", "timed", "distance", "rpe_only"]),
  skipped: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/*  saveDraft — persist in-flight notes / actual minutes (no completion)      */
/* -------------------------------------------------------------------------- */

const SaveDraftInput = z.intersection(
  Ctx,
  z.object({
    clientNotes: z.string().nullable().optional(),
    actualDurationMin: z.number().int().nonnegative().nullable().optional(),
  }),
);

export const saveDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveDraftInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.kind === "client") {
      const clientId = await resolveClientId(supabase, userId);
      // Check for an existing row first so we never overwrite completion
      // state (notes-only autosave must not flip a workout to "completed",
      // and editing a finished workout's notes must not clear completed_at
      // via the column default).
      const { data: existing } = await supabase
        .from("pl_day_completions")
        .select("id")
        .eq("client_id", clientId)
        .eq("day_id", data.dayId)
        .maybeSingle();
      if (existing?.id) {
        const { error } = await supabase
          .from("pl_day_completions")
          .update({
            client_notes: data.clientNotes ?? null,
            actual_duration_min: data.actualDurationMin ?? null,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("pl_day_completions")
          .insert({
            client_id: clientId,
            day_id: data.dayId,
            client_notes: data.clientNotes ?? null,
            actual_duration_min: data.actualDurationMin ?? null,
            // Explicit null — the column has DEFAULT now() so omitting this
            // would mark the workout as completed on first note keystroke.
            completed_at: null,
          });
        if (error) throw error;
      }
      return { ok: true };
    }
    await assertOwnsEnrollment(supabase, data.enrollmentId);
    const { error } = await supabase
      .from("member_workout_completions")
      .upsert(
        {
          enrollment_id: data.enrollmentId,
          week_index: data.weekIndex,
          day_index: data.dayIndex,
          notes: data.clientNotes ?? null,
          actual_duration_min: data.actualDurationMin ?? null,
        },
        { onConflict: "enrollment_id,week_index,day_index" },
      );
    if (error) throw error;
    return { ok: true };
  });

const CompleteInput = z.intersection(
  Ctx,
  z.object({
    requiredRows: z.array(RequiredRowSchema).default([]),
    activityTimestamps: z.array(z.string()).optional(),
    completionMethod: z.enum(["manual", "automatic"]).default("manual"),
    completionSource: z.string().optional(),
    sessionRating: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().nullable().optional(),
    confirmedMissingLogs: z.boolean().optional(),
    actualDurationMin: z.number().int().nonnegative().nullable().optional(),
    sessionWeightTotal: z.number().nullable().optional(),
    sessionWeightUnit: z.enum(["kg", "lb"]).nullable().optional(),
  }),
);

export const completeWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CompleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    // 1) Load existing completion row to get started_at + check idempotency.
    // 2) Load logged sets, compute completeness with shared helper.
    // 3) UPSERT completion with computed fields.
    if (data.kind === "client") {
      const clientId = await resolveClientId(supabase, userId);
      const { data: existing } = await supabase
        .from("pl_day_completions")
        .select("id, started_at, completed_at, last_activity_at")
        .eq("client_id", clientId)
        .eq("day_id", data.dayId)
        .maybeSingle();

      // Already completed → apply edits (notes / rating / duration) in place
      // rather than silently no-op. Stats (elapsed, logged_sets_count, etc.)
      // are preserved from the original completion.
      if (existing?.completed_at) {
        const patch: {
          client_notes?: string | null;
          session_rating?: number | null;
          actual_duration_min?: number | null;
        } = {};
        if (data.notes !== undefined) patch.client_notes = data.notes ?? null;
        if (data.sessionRating !== undefined) patch.session_rating = data.sessionRating ?? null;
        if (data.actualDurationMin !== undefined && data.actualDurationMin !== null) {
          patch.actual_duration_min = data.actualDurationMin;
        }
        const hasEdits = Object.keys(patch).length > 0;
        if (hasEdits) {
          const { error } = await supabase
            .from("pl_day_completions")
            .update(patch)
            .eq("id", existing.id);
          if (error) throw error;
        }
        return { id: existing.id, alreadyCompleted: true, edited: hasEdits };
      }

      const startedAt = existing?.started_at ?? nowIso;
      // Pull saved row results for completeness.
      const rowIds = data.requiredRows.map((r) => r.rowId);
      const { data: setRows } = rowIds.length
        ? await supabase
            .from("pl_row_results")
            .select("row_id, set_index, actual_reps, actual_load_lb, actual_load_kg, actual_rpe, actual_rir, completed_duration_seconds")
            .eq("client_id", clientId)
            .in("row_id", rowIds)
        : { data: [] as any[] };

      const sets: LoggedSetSpec[] = (setRows ?? []).map((s: any) => ({
        rowId: s.row_id,
        setIndex: s.set_index,
        reps: s.actual_reps,
        loadLb: s.actual_load_lb,
        loadKg: s.actual_load_kg,
        rpe: s.actual_rpe,
        rir: s.actual_rir,
        completedDurationSeconds: s.completed_duration_seconds,
      }));
      const required: RequiredRowSpec[] = data.requiredRows;
      const summary = summarizeCompleteness(required, sets);

      if (summary.completedWithMissingLogs && !data.confirmedMissingLogs) {
        return { needsMissingLogConfirmation: true, summary };
      }

      const elapsed = computeElapsedSeconds(startedAt, nowIso);
      const active = computeActiveSeconds(startedAt, nowIso, data.activityTimestamps ?? []);

      const update: Record<string, any> = {
        client_id: clientId,
        day_id: data.dayId,
        started_at: startedAt,
        in_progress_at: existing?.last_activity_at ?? startedAt,
        completed_at: nowIso,
        last_activity_at: nowIso,
        actual_duration_min:
          data.actualDurationMin ??
          (elapsed != null ? Math.max(1, Math.round(elapsed / 60)) : null),
        elapsed_duration_seconds: elapsed,
        active_duration_seconds: active,
        completion_method: data.completionMethod,
        completion_source: data.completionSource ?? "workout_view",
        session_rating: data.sessionRating ?? null,
        client_notes: data.notes ?? null,
        session_weight_total: data.sessionWeightTotal ?? null,
        session_weight_unit: data.sessionWeightUnit ?? null,
        required_sets_count: summary.requiredSets,
        logged_sets_count: summary.loggedSets,
        skipped_exercises_count: summary.skippedExercises,
        logging_percentage: summary.loggingPercentage,
        logging_quality: summary.loggingQuality,
        completed_with_missing_logs: summary.completedWithMissingLogs,
      };
      const { data: row, error } = await supabase
        .from("pl_day_completions")
        .upsert(update, { onConflict: "client_id,day_id" })
        .select("id")
        .single();
      if (error) throw error;
      return { id: row.id, summary };
    }

    // member
    await assertOwnsEnrollment(supabase, data.enrollmentId);
    const { data: existing } = await supabase
      .from("member_workout_completions")
      .select("id, started_at, completed_at, last_activity_at")
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .maybeSingle();
    if (existing?.completed_at) {
      const patch: {
        client_notes?: string | null;
        notes?: string | null;
        session_rating?: number | null;
      } = {};
      if (data.notes !== undefined) {
        patch.client_notes = data.notes ?? null;
        patch.notes = data.notes ?? null;
      }
      if (data.sessionRating !== undefined) patch.session_rating = data.sessionRating ?? null;
      const hasEdits = Object.keys(patch).length > 0;
      if (hasEdits) {
        const { error } = await supabase
          .from("member_workout_completions")
          .update(patch)
          .eq("id", existing.id);
        if (error) throw error;
      }
      return { id: existing.id, alreadyCompleted: true, edited: hasEdits };
    }
    const startedAt = existing?.started_at ?? nowIso;

    // Required rows use rowId === exerciseIndex stringified for member kind.
    const exerciseIndexes = data.requiredRows
      .map((r) => Number(r.rowId))
      .filter((n) => Number.isFinite(n));
    const { data: setRows } = exerciseIndexes.length
      ? await supabase
          .from("member_set_logs")
          .select("exercise_index, set_index, reps, load_lb, load_kg, rpe, rir, completed_duration_seconds")
          .eq("enrollment_id", data.enrollmentId)
          .eq("week_index", data.weekIndex)
          .eq("day_index", data.dayIndex)
          .in("exercise_index", exerciseIndexes)
      : { data: [] as any[] };

    const sets: LoggedSetSpec[] = (setRows ?? []).map((s: any) => ({
      rowId: String(s.exercise_index),
      setIndex: s.set_index,
      reps: s.reps,
      loadLb: s.load_lb,
      loadKg: s.load_kg,
      rpe: s.rpe,
      rir: s.rir,
      completedDurationSeconds: s.completed_duration_seconds,
    }));
    const summary = summarizeCompleteness(data.requiredRows, sets);

    if (summary.completedWithMissingLogs && !data.confirmedMissingLogs) {
      return { needsMissingLogConfirmation: true, summary };
    }

    const elapsed = computeElapsedSeconds(startedAt, nowIso);
    const active = computeActiveSeconds(startedAt, nowIso, data.activityTimestamps ?? []);

    const update: Record<string, any> = {
      enrollment_id: data.enrollmentId,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      started_at: startedAt,
      completed_at: nowIso,
      last_activity_at: nowIso,
      actual_duration_min: elapsed != null ? Math.max(1, Math.round(elapsed / 60)) : null,
      elapsed_duration_seconds: elapsed,
      active_duration_seconds: active,
      completion_method: data.completionMethod,
      completion_source: data.completionSource ?? "workout_view",
      session_rating: data.sessionRating ?? null,
      client_notes: data.notes ?? null,
      notes: data.notes ?? null,
      required_sets_count: summary.requiredSets,
      logged_sets_count: summary.loggedSets,
      skipped_exercises_count: summary.skippedExercises,
      logging_percentage: summary.loggingPercentage,
      logging_quality: summary.loggingQuality,
      completed_with_missing_logs: summary.completedWithMissingLogs,
    };
    const { data: row, error } = await supabase
      .from("member_workout_completions")
      .upsert(update, { onConflict: "enrollment_id,week_index,day_index" })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id, summary };
  });

/* -------------------------------------------------------------------------- */
/*  reopenWorkout — clear completed_at so the user can keep logging            */
/* -------------------------------------------------------------------------- */

export const reopenWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Ctx.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    if (data.kind === "client") {
      const clientId = await resolveClientId(supabase, userId);
      const { error } = await supabase
        .from("pl_day_completions")
        .update({ completed_at: null, last_activity_at: nowIso })
        .eq("client_id", clientId)
        .eq("day_id", data.dayId);
      if (error) throw error;
    } else {
      await assertOwnsEnrollment(supabase, data.enrollmentId);
      const { error } = await supabase
        .from("member_workout_completions")
        .update({ completed_at: null, last_activity_at: nowIso })
        .eq("enrollment_id", data.enrollmentId)
        .eq("week_index", data.weekIndex)
        .eq("day_index", data.dayIndex);
      if (error) throw error;
    }
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/*  submitOrEditReview — idempotent UPSERT, tracks edit history                */
/* -------------------------------------------------------------------------- */

const ReviewInput = z.intersection(
  Ctx,
  z.object({
    overallRating: z.number().int().min(1).max(5),
    sessionRpe: z.number().int().min(1).max(10),
    pain: z.boolean().default(false),
    painLevel: z.number().int().min(1).max(10).nullable().optional(),
    painArea: z.string().nullable().optional(),
    painNote: z.string().nullable().optional(),
    clientNote: z.string().nullable().optional(),
    strengthFeel: z.string().nullable().optional(),
    fatigueFeel: z.string().nullable().optional(),
    hitTarget: z.string().nullable().optional(),
    // When an admin/coach is in Client POV mode, the signed-in user has no
    // `clients` row of their own. Pass the impersonated client's id and we
    // resolve scope from that — after verifying the caller really is an
    // admin or coach.
    actAsClientId: z.string().uuid().nullable().optional(),
  }),
);

export const submitOrEditReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    if (data.kind === "client") {
      let clientId: string;
      let usedOverride = false;
      if (data.actAsClientId) {
        const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
          supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
          supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
        ]);
        if (!isAdmin && !isCoach) {
          throw new Error("Only admins or coaches can submit a review on behalf of a client");
        }
        clientId = data.actAsClientId;
        usedOverride = true;
      } else {
        clientId = await resolveClientId(supabase, userId);
      }
      // Admin/coach POV writes bypass RLS via the service-role client because
      // pl_workout_feedback's INSERT/UPDATE policies are scoped to the client's
      // own auth.uid.
      const writer = usedOverride
        ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
        : supabase;
      const { data: completion } = await supabase
        .from("pl_day_completions")
        .select("id")
        .eq("client_id", clientId)
        .eq("day_id", data.dayId)
        .maybeSingle();
      if (!completion?.id) throw new Error("Cannot submit review before completion exists");

      const { data: existing } = await writer
        .from("pl_workout_feedback")
        .select("id, review_edit_count, review_submitted_at")
        .eq("completion_id", completion.id)
        .maybeSingle();

      const base = {
        completion_id: completion.id,
        client_id: clientId,
        day_id: data.dayId,
        overall_rating: data.overallRating,
        session_rpe: data.sessionRpe,
        pain: data.pain,
        pain_level: data.pain ? data.painLevel ?? null : null,
        pain_area: data.pain ? data.painArea ?? null : null,
        pain_note: data.pain ? data.painNote ?? null : null,
        client_note: data.clientNote ?? null,
        strength_feel: data.strengthFeel ?? null,
        fatigue_feel: data.fatigueFeel ?? null,
        hit_target: data.hitTarget ?? null,
      };

      if (existing?.id) {
        const { data: row, error } = await writer
          .from("pl_workout_feedback")
          .update({
            ...base,
            review_last_edited_at: nowIso,
            review_edit_count: (existing.review_edit_count ?? 0) + 1,
            review_updated_by: userId,
          })
          .eq("id", existing.id)
          .select("id")
          .single();
        if (error) throw error;
        return { id: row.id, edited: true };
      }
      const { data: row, error } = await writer
        .from("pl_workout_feedback")
        .insert({
          ...base,
          review_submitted_at: nowIso,
          review_edit_count: 0,
          review_updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: row.id, edited: false };
    }

    // member
    await assertOwnsEnrollment(supabase, data.enrollmentId);
    const { data: completion } = await supabase
      .from("member_workout_completions")
      .select("id")
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .maybeSingle();

    const { data: existing } = await supabase
      .from("member_workout_reviews")
      .select("id, review_edit_count, review_submitted_at")
      .eq("enrollment_id", data.enrollmentId)
      .eq("week_index", data.weekIndex)
      .eq("day_index", data.dayIndex)
      .maybeSingle();

    const base = {
      enrollment_id: data.enrollmentId,
      completion_id: completion?.id ?? null,
      week_index: data.weekIndex,
      day_index: data.dayIndex,
      overall_rating: data.overallRating,
      session_rpe: data.sessionRpe,
      pain: data.pain,
      pain_level: data.pain ? data.painLevel ?? null : null,
      pain_area: data.pain ? data.painArea ?? null : null,
      pain_note: data.pain ? data.painNote ?? null : null,
      client_note: data.clientNote ?? null,
      strength_feel: data.strengthFeel ?? null,
      fatigue_feel: data.fatigueFeel ?? null,
      hit_target: data.hitTarget ?? null,
    };

    if (existing?.id) {
      const { data: row, error } = await supabase
        .from("member_workout_reviews")
        .update({
          ...base,
          review_last_edited_at: nowIso,
          review_edit_count: (existing.review_edit_count ?? 0) + 1,
          review_updated_by: userId,
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) throw error;
      return { id: row.id, edited: true };
    }
    const { data: row, error } = await supabase
      .from("member_workout_reviews")
      .insert({
        ...base,
        review_submitted_at: nowIso,
        review_edit_count: 0,
        review_updated_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id, edited: false };
  });

export type WorkoutCompletionCtx = CtxT;