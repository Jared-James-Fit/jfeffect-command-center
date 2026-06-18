/**
 * Coaching client adapter. Phase 1 skeleton — methods throw NotImplemented
 * until Phase 2 wires them onto the existing pl_* queries that the current
 * coaching components use today. The signatures below pin the contract.
 */
import {
  NotImplemented,
  type WorkoutContextAdapter,
  type WorkoutContextRef,
  type WorkoutScheduleDay,
  type WorkoutCompletion,
  type RescheduleInput,
  type LogSetInput,
  type WorkoutDay,
  type ExerciseRowDTO,
  type RowResultDTO,
  type ExerciseNoteDTO,
  type HistoryEntryDTO,
  type MaxEntryDTO,
  type DayCompletionDTO,
  type DayCompletionPatch,
  type RowBlockSummaryDTO,
  type CoachPainFlagDTO,
  type UpsertRowResultInput,
  type UpsertExerciseNoteInput,
  type EnrollmentSummaryDTO,
  type ReviewDTO,
  type PlDayRaw,
  type PlRowRaw,
  type PlRowResultRaw,
} from "./types";
import { getClientSchedule, applyBulkScheduleChange } from "@/lib/schedule-bulk.functions";
import { supabase } from "@/integrations/supabase/client";
import { listClientMaxes as listClientMaxesRaw } from "@/lib/pl-maxes";
import { saveExerciseUnitPref as saveExerciseUnitPrefRaw } from "@/lib/exercise-unit-prefs";
import { getRowBlockSummariesFn } from "@/lib/exercise-blocks.functions";
import { notifyCoachOfWorkoutFailure } from "@/lib/support-alerts.functions";

const sb = supabase as any;

export function createClientAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  if (ref.kind !== "client") throw new Error("createClientAdapter requires kind=client");
  return {
    kind: "client",
    ref,
    capabilities: {
      canEditTemplate: false,
      canEditOwnLogs: true,
      canReschedule: true,
      canSubstituteExercise: true,
      canSeeCoachNotes: true,
      canSeeCoachIntel: true,
      canLeaveCoachFeedback: false, // viewer is the client; coach POV sets this elsewhere
      canSeeAdminNotes: false,
      canAssignPrograms: false,
    },
    async listSchedule(opts): Promise<WorkoutScheduleDay[]> {
      const res = await getClientSchedule({ data: { clientId: ref.ownerId } });
      const weekById = new Map((res.weeks ?? []).map((w: any) => [w.id, w]));
      const blockById = new Map((res.blocks ?? []).map((b: any) => [b.id, b]));
      const completedByDay = new Map<string, any>();
      for (const c of res.completions ?? []) {
        if ((c as any).completed_at) completedByDay.set((c as any).day_id, c);
      }
      const from = opts?.fromDate ?? null;
      const to = opts?.toDate ?? null;
      const out: WorkoutScheduleDay[] = [];
      for (const d of res.days ?? []) {
        const date: string | null = (d as any).scheduled_date ?? null;
        if (!date) continue;
        if (from && date < from) continue;
        if (to && date > to) continue;
        const week = weekById.get((d as any).week_id) as any;
        const block = week ? (blockById.get(week.block_id) as any) : null;
        const comp = completedByDay.get((d as any).id);
        out.push({
          id: (d as any).id,
          date,
          week: week?.week_index ?? 0,
          day: (d as any).day_index ?? 0,
          title: (d as any).title ?? (d as any).focus ?? null,
          blockId: block?.id ?? null,
          blockName: block?.name ?? null,
          completed: !!comp,
          completedAt: comp?.completed_at ?? null,
        });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    },
    async listCompletions(opts): Promise<WorkoutCompletion[]> {
      const res = await getClientSchedule({ data: { clientId: ref.ownerId } });
      const weekById = new Map((res.weeks ?? []).map((w: any) => [w.id, w]));
      const dayById = new Map((res.days ?? []).map((d: any) => [d.id, d]));
      const completions: WorkoutCompletion[] = [];
      for (const c of res.completions ?? []) {
        if (!(c as any).completed_at) continue;
        const d = dayById.get((c as any).day_id) as any;
        const w = d ? (weekById.get(d.week_id) as any) : null;
        completions.push({
          id: (c as any).id,
          dayId: (c as any).day_id,
          week: w?.week_index ?? 0,
          day: d?.day_index ?? 0,
          completedAt: (c as any).completed_at,
        });
      }
      completions.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      return typeof opts?.limit === "number" ? completions.slice(0, opts.limit) : completions;
    },
    async reschedule(input: RescheduleInput): Promise<void> {
      // Phase 2a wires single-day moves through the existing bulk endpoint.
      // Scope-aware fan-out (week / all_future / entire) lands with the
      // WorkoutScheduleSection in Phase 4.
      if (input.scope !== "this_workout_only") {
        throw new NotImplemented(`reschedule:${input.scope}`, "client");
      }
      await applyBulkScheduleChange({
        data: {
          moves: [{ dayId: input.dayId, newDate: input.newDate }],
          scope: "single",
        },
      });
    },
    async logSet(input: LogSetInput): Promise<void> {
      // Client logger writes through upsertRowResult; logSet is the
      // adapter-agnostic shortcut for new rows.
      await this.upsertRowResult({
        rowId: input.rowId,
        setIndex: input.setIndex,
        reps: input.reps ?? null,
        loadLb: input.loadLb ?? null,
        rpe: input.rpe ?? null,
        rir: input.rir ?? null,
        isWorkingSet: input.isWorkingSet ?? null,
        notes: input.notes ?? null,
        completedDurationSeconds: input.completedDurationSeconds ?? null,
      });
    },
    async completeDay(dayId: string): Promise<void> {
      await this.updateDayCompletion(dayId, {
        completedAt: new Date().toISOString(),
      });
    },

    /* ---- Phase C day-view surface ---- */
    async getDay(dayId: string): Promise<WorkoutDay> {
      const { data: d, error } = await sb
        .from("pl_days")
        .select("*, pl_weeks(id, week_index, block_id, pl_blocks(id, name))")
        .eq("id", dayId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!d) throw new Error(`pl_days row not found for ${dayId}`);
      const w = (d as any).pl_weeks ?? null;
      const b = w?.pl_blocks ?? null;
      return {
        id: dayId,
        week: w?.week_index ?? 0,
        day: (d as any).day_index ?? 0,
        title: (d as any).title ?? (d as any).focus ?? null,
        focus: (d as any).focus ?? null,
        targetMinutes:
          (d as any).target_minutes ?? (d as any).est_minutes ?? null,
        blockId: b?.id ?? null,
        blockName: b?.name ?? null,
        scheduledDate: (d as any).scheduled_date ?? null,
      };
    },

    /* ---- Phase B turn 1 — raw passthrough surface ---- */
    async getDayRaw(dayId: string): Promise<PlDayRaw | null> {
      const { data, error } = await sb
        .from("pl_days")
        .select("*")
        .eq("id", dayId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as PlDayRaw | null;
    },

    async listRowsRaw(dayId: string): Promise<PlRowRaw[]> {
      const { data, error } = await sb
        .from("pl_exercise_rows")
        .select(
          "*, exercises(id,name,video_url,vimeo_embed_url,thumbnail_url,cues,common_mistakes,muscle_group,category,pl_lift_group,warmup_protocol_id,is_powerlifting,warmup_notes,default_load_unit,exercise_category,is_competition_lift,competition_lift_type)",
        )
        .eq("day_id", dayId)
        .order("sort_order");
      if (error) throw new Error(error.message);
      return (data ?? []) as PlRowRaw[];
    },

    async listRowResultsRaw(dayId: string): Promise<PlRowResultRaw[]> {
      const { data: rowIdsRes, error: rowErr } = await sb
        .from("pl_exercise_rows")
        .select("id")
        .eq("day_id", dayId);
      if (rowErr) throw new Error(rowErr.message);
      const rowIds = (rowIdsRes ?? []).map((r: any) => r.id);
      if (!rowIds.length) return [];
      const { data, error } = await sb
        .from("pl_row_results")
        .select("*")
        .in("row_id", rowIds)
        .eq("client_id", ref.ownerId);
      if (error) throw new Error(error.message);
      return (data ?? []) as PlRowResultRaw[];
    },

    async getDayCompletionRaw(dayId) {
      const { data, error } = await sb
        .from("pl_day_completions")
        .select("*")
        .eq("day_id", dayId)
        .eq("client_id", ref.ownerId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Record<string, any> | null;
    },

    async listExerciseNotesRaw(dayId) {
      const { data, error } = await sb
        .from("pl_exercise_notes")
        .select("*")
        .eq("client_id", ref.ownerId)
        .eq("day_id", dayId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Record<string, any>[];
    },

    async getWorkoutFeedbackRaw(dayId) {
      const { data, error } = await sb
        .from("pl_workout_feedback")
        .select("*")
        .eq("day_id", dayId)
        .eq("client_id", ref.ownerId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Record<string, any> | null;
    },

    async getActiveSubject() {
      const { data, error } = await sb
        .from("clients")
        .select("id, full_name, preferred_weight_unit")
        .eq("user_id", ref.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const unit = (data as any).preferred_weight_unit;
      return {
        id: (data as any).id as string,
        full_name: (data as any).full_name ?? null,
        preferred_weight_unit: unit === "kg" ? "kg" : unit === "lb" ? "lb" : null,
      };
    },

    async listRows(dayId: string): Promise<ExerciseRowDTO[]> {
      const { data, error } = await sb
        .from("pl_exercise_rows")
        .select(
          "*, exercises(id,name,video_url,vimeo_embed_url,thumbnail_url,cues,common_mistakes,muscle_group,category,pl_lift_group,warmup_protocol_id,is_powerlifting,warmup_notes,default_load_unit,exercise_category,is_competition_lift,competition_lift_type)",
        )
        .eq("day_id", dayId)
        .order("sort_order");
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => {
        const ex = r.exercises ?? null;
        return {
          id: r.id,
          exerciseId: ex?.id ?? r.exercise_id ?? null,
          exerciseName: ex?.name ?? r.exercise_name ?? "Exercise",
          videoUrl: ex?.video_url ?? null,
          vimeoEmbedUrl: ex?.vimeo_embed_url ?? null,
          thumbnailUrl: ex?.thumbnail_url ?? null,
          muscleGroup: ex?.muscle_group ?? null,
          category: ex?.category ?? null,
          cues: ex?.cues ?? null,
          commonMistakes: ex?.common_mistakes ?? null,
          sortOrder: Number.isFinite(Number(r.sort_order))
            ? Number(r.sort_order)
            : 0,
          targetSets: r.sets ?? null,
          targetReps: r.reps != null ? String(r.reps) : null,
          targetEffort:
            r.rpe != null && String(r.rpe).trim() !== ""
              ? `RPE ${r.rpe}`
              : r.rir != null && String(r.rir).trim() !== ""
                ? `RIR ${r.rir}`
                : null,
          targetLoadText:
            r.load_lb != null
              ? String(r.load_lb)
              : r.load_kg != null
                ? String(r.load_kg)
                : r.load_text ?? null,
          restSeconds: r.rest_seconds ?? null,
          notes: r.notes ?? null,
          warmupProtocolId: ex?.warmup_protocol_id ?? null,
          defaultLoadUnit: ex?.default_load_unit ?? null,
          blockGroupId: r.block_group_id ?? null,
          raw: r,
        };
      });
    },

    async listRowResults(dayId: string): Promise<RowResultDTO[]> {
      // Fetch the row ids for this day, then fan out to pl_row_results
      // restricted to this client. Mirrors WorkoutDayView's behaviour.
      const { data: rowIdsRes, error: rowErr } = await sb
        .from("pl_exercise_rows")
        .select("id")
        .eq("day_id", dayId);
      if (rowErr) throw new Error(rowErr.message);
      const rowIds = (rowIdsRes ?? []).map((r: any) => r.id);
      if (!rowIds.length) return [];
      const { data, error } = await sb
        .from("pl_row_results")
        .select("*")
        .in("row_id", rowIds)
        .eq("client_id", ref.ownerId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => ({
        id: r.id,
        rowId: r.row_id,
        setIndex: r.set_index,
        reps: r.actual_reps ?? null,
        loadLb: r.normalized_lb ?? r.actual_load ?? null,
        actualLoadUnit: r.actual_load_unit ?? r.entered_unit ?? null,
        rpe: r.actual_rpe_num ?? null,
        rir: r.actual_rir ?? null,
        isWorkingSet: r.is_working_set ?? null,
        notes: r.notes ?? null,
        completedDurationSeconds: r.completed_duration_seconds ?? null,
        loggedAt: r.completed_at ?? r.updated_at ?? null,
      }));
    },

    async listExerciseNotes(dayId: string): Promise<ExerciseNoteDTO[]> {
      const { data, error } = await sb
        .from("pl_exercise_notes")
        .select("*")
        .eq("client_id", ref.ownerId)
        .eq("day_id", dayId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((n: any) => ({
        id: n.id,
        rowId: n.row_id ?? null,
        exerciseId: n.exercise_id ?? null,
        note: n.note ?? "",
        createdAt: n.created_at ?? n.updated_at ?? "",
        authorRole: n.author_role === "coach" ? "coach" : "trainee",
      }));
    },

    async listExerciseHistory(exerciseId: string, opts): Promise<HistoryEntryDTO[]> {
      if (!exerciseId) return [];
      const { data, error } = await sb
        .from("pl_row_results")
        .select(
          "set_index, completed_at, updated_at, actual_reps, actual_rpe_num, normalized_lb, actual_load, pl_exercise_rows!inner(exercise_id)",
        )
        .eq("client_id", ref.ownerId)
        .eq("pl_exercise_rows.exercise_id", exerciseId)
        .order("updated_at", { ascending: false })
        .limit(opts?.limit ?? 100);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => ({
        date: String(r.completed_at ?? r.updated_at ?? "").slice(0, 10),
        setIndex: r.set_index,
        reps: r.actual_reps ?? null,
        loadLb: r.normalized_lb ?? r.actual_load ?? null,
        rpe: r.actual_rpe_num ?? null,
      }));
    },

    async listClientMaxes(): Promise<MaxEntryDTO[]> {
      const rows = await listClientMaxesRaw(ref.ownerId);
      return rows
        .filter((r: any) => r.exercise_id)
        .map((r: any) => ({
          exerciseId: r.exercise_id as string,
          oneRmLb:
            r.one_rm_lb ??
            (r.one_rm_kg != null ? Math.round(r.one_rm_kg * 2.2046226218) : null),
          estimated: !!r.estimated,
        }));
    },

    async getDayCompletion(dayId: string): Promise<DayCompletionDTO | null> {
      const { data, error } = await sb
        .from("pl_day_completions")
        .select("*")
        .eq("day_id", dayId)
        .eq("client_id", ref.ownerId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id ?? null,
        startedAt: data.started_at ?? null,
        inProgressAt: data.in_progress_at ?? null,
        completedAt: data.completed_at ?? null,
        notes: data.notes ?? null,
        actualMinutes: data.actual_minutes ?? null,
      };
    },

    async getRowBlockSummaries(rowIds: string[]): Promise<RowBlockSummaryDTO[]> {
      if (!rowIds.length) return [];
      const summary = (await getRowBlockSummariesFn({ data: { rowIds } })) as
        | Record<string, boolean>
        | Record<string, string | null>;
      return Object.entries(summary).map(([rowId, v]) => ({
        rowId,
        blockId: null,
        summary: typeof v === "string" ? v : v ? "unsupported" : null,
      }));
    },

    async listCoachPainFlags(dayId: string): Promise<CoachPainFlagDTO[]> {
      const { data, error } = await sb
        .from("coach_pain_flags")
        .select("id, row_id, severity, note, created_at, day_id, client_id")
        .eq("client_id", ref.ownerId)
        .eq("day_id", dayId);
      if (error) {
        // Day-scoped column may not exist on every deployment; fall back.
        return [];
      }
      return (data ?? []).map((p: any) => ({
        id: p.id,
        rowId: p.row_id ?? null,
        severity: (p.severity as "low" | "medium" | "high") ?? "low",
        note: p.note ?? null,
        createdAt: p.created_at ?? "",
      }));
    },

    async getEnrollmentSummary(): Promise<EnrollmentSummaryDTO> {
      // Membership-only concept; coaching clients have no single enrollment row.
      throw new NotImplemented("getEnrollmentSummary", "client");
    },

    async getReview(_dayId: string): Promise<ReviewDTO | null> {
      // Coaching reviews live in pl_workout_feedback and have a different
      // shape; the shared workout surface doesn't consume them yet.
      return null;
    },

    async upsertRowResult(input: UpsertRowResultInput): Promise<string> {
      const payload: Record<string, unknown> = {
        row_id: input.rowId,
        client_id: ref.ownerId,
        set_index: input.setIndex,
        actual_reps: input.reps ?? null,
        normalized_lb: input.loadLb ?? null,
        actual_load: input.loadLb ?? null,
        actual_load_unit: input.actualLoadUnit ?? "lb",
        entered_unit: input.actualLoadUnit ?? "lb",
        actual_rpe_num: input.rpe ?? null,
        actual_rir: input.rir ?? null,
        is_working_set: input.isWorkingSet ?? null,
        notes: input.notes ?? null,
        completed_duration_seconds: input.completedDurationSeconds ?? null,
        completed_at: new Date().toISOString(),
      };
      if (input.id) {
        const { error } = await sb
          .from("pl_row_results")
          .update(payload)
          .eq("id", input.id);
        if (error) throw new Error(error.message);
        return input.id;
      }
      const { data, error } = await sb
        .from("pl_row_results")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as any)?.id ?? "";
    },

    async deleteRowResult(id: string): Promise<void> {
      const { error } = await sb.from("pl_row_results").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },

    async upsertExerciseNote(input: UpsertExerciseNoteInput): Promise<void> {
      if (input.id) {
        const { error } = await sb
          .from("pl_exercise_notes")
          .update({ note: input.note })
          .eq("id", input.id);
        if (error) throw new Error(error.message);
        return;
      }
      const payload: Record<string, unknown> = {
        client_id: ref.ownerId,
        row_id: input.rowId ?? null,
        exercise_id: input.exerciseId ?? null,
        note: input.note,
      };
      const { error } = await sb.from("pl_exercise_notes").insert(payload);
      if (error) throw new Error(error.message);
    },

    async updateDayCompletion(dayId: string, patch: DayCompletionPatch): Promise<void> {
      const { data: existing } = await sb
        .from("pl_day_completions")
        .select("id")
        .eq("day_id", dayId)
        .eq("client_id", ref.ownerId)
        .maybeSingle();
      const dbPatch: Record<string, unknown> = {};
      if (patch.startedAt !== undefined) dbPatch.started_at = patch.startedAt;
      if (patch.inProgressAt !== undefined) dbPatch.in_progress_at = patch.inProgressAt;
      if (patch.completedAt !== undefined) dbPatch.completed_at = patch.completedAt;
      if (patch.notes !== undefined) dbPatch.notes = patch.notes;
      if (patch.actualMinutes !== undefined) dbPatch.actual_minutes = patch.actualMinutes;
      if (existing?.id) {
        const { error } = await sb
          .from("pl_day_completions")
          .update(dbPatch)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await sb
          .from("pl_day_completions")
          .insert({ day_id: dayId, client_id: ref.ownerId, ...dbPatch });
        if (error) throw new Error(error.message);
      }
    },

    async saveExerciseUnitPref(input: { exerciseId: string; unit: "lb" | "kg" }): Promise<void> {
      await saveExerciseUnitPrefRaw(ref.ownerId, input.exerciseId, input.unit);
    },

    async listUnitPrefs(exerciseIds: string[]): Promise<{ exerciseId: string; unit: "lb" | "kg" }[]> {
      if (!exerciseIds.length) return [];
      const { data, error } = await sb
        .from("client_exercise_unit_prefs")
        .select("exercise_id, unit")
        .eq("client_id", ref.ownerId)
        .in("exercise_id", exerciseIds);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: any) => ({
        exerciseId: r.exercise_id as string,
        unit: (r.unit === "kg" ? "kg" : "lb") as "lb" | "kg",
      }));
    },

    /* ---- raw passthrough writes (Phase B turn 4b) ----
     * Byte-identical to the previous `sb.from("pl_*").update/insert` calls
     * that WorkoutDayView made directly. Member adapter reshapes in turn 4c.
     */
    async upsertPlRowResultRaw(payload, id) {
      if (id) {
        const { error } = await sb.from("pl_row_results").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return { id };
      }
      const { data, error } = await sb
        .from("pl_row_results")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id ?? null };
    },
    async upsertPlExerciseNoteRaw(payload, id) {
      if (id) {
        const { error } = await sb.from("pl_exercise_notes").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await sb.from("pl_exercise_notes").insert(payload);
      if (error) throw new Error(error.message);
    },
    async upsertPlDayCompletionRaw(payload, id) {
      if (id) {
        const { error } = await sb.from("pl_day_completions").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await sb.from("pl_day_completions").insert(payload);
      if (error) throw new Error(error.message);
    },

    async notifyCoachOfFailure(input: { dayId: string; reason: string }): Promise<void> {
      await notifyCoachOfWorkoutFailure({
        data: {
          workout_id: input.dayId,
          error_message: input.reason,
          error_type: "workout_load_failure",
        },
      });
    },
  };
}