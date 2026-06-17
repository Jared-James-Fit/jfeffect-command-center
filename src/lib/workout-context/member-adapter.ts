/**
 * Membership adapter. Phase 1 skeleton — methods throw NotImplemented
 * until Phase 2 wires them onto member_plan_enrollments / member_set_logs /
 * member_workout_completions. Capabilities deliberately deny coach-only
 * write paths (template edits, coach notes) so members cannot escalate
 * even if a shared component forgets to check.
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
} from "./types";
import {
  getEnrollmentSchedule,
  rescheduleDay,
  logSet as logSetFn,
  completeWorkout,
} from "@/lib/member-plans.functions";
import { supabase } from "@/integrations/supabase/client";

/**
 * Members address workouts by (week_index, day_index) tuples — there is
 * no per-day UUID like the coaching pl_days table. The adapter encodes
 * those tuples into a synthetic `dayId` string `"w:d"` so the shared
 * UI can keep using a flat string id. Decoded on every write below.
 */
function encodeDayId(week: number, day: number) {
  return `${week}:${day}`;
}
function decodeDayId(id: string): { week: number; day: number } {
  const [w, d] = id.split(":").map((n) => Number(n));
  if (!Number.isFinite(w) || !Number.isFinite(d)) {
    throw new Error(`member adapter: invalid dayId ${id}`);
  }
  return { week: w, day: d };
}

export function createMemberAdapter(ref: WorkoutContextRef): WorkoutContextAdapter {
  if (ref.kind !== "member") throw new Error("createMemberAdapter requires kind=member");
  if (!ref.enrollmentId) throw new Error("member adapter requires enrollmentId");
  const enrollmentId = ref.enrollmentId;
  return {
    kind: "member",
    ref,
    capabilities: {
      canEditTemplate: false,
      canEditOwnLogs: true,
      canReschedule: true,
      canSubstituteExercise: false, // membership programs are static library entries
      canSeeCoachNotes: false,
      canSeeCoachIntel: false,
      canLeaveCoachFeedback: false,
      canSeeAdminNotes: false,
      canAssignPrograms: false,
    },
    async listSchedule(opts): Promise<WorkoutScheduleDay[]> {
      const { schedule } = await getEnrollmentSchedule({ data: { enrollmentId } });
      // Pull plan payload for titles + completions in parallel.
      const [planRes, completionsRes] = await Promise.all([
        supabase
          .from("member_plan_enrollments")
          .select("member_plans(published_payload)")
          .eq("id", enrollmentId)
          .maybeSingle(),
        supabase
          .from("member_workout_completions")
          .select("week_index, day_index, completed_at")
          .eq("enrollment_id", enrollmentId),
      ]);
      const weeksData =
        ((planRes.data as any)?.member_plans?.published_payload?.weeks_data ?? []) as any[];
      const titleByKey = new Map<string, string | null>();
      for (const w of weeksData) {
        for (const d of w.days ?? []) {
          titleByKey.set(`${w.week_index}:${d.day_index}`, d.title ?? d.focus ?? null);
        }
      }
      const compByKey = new Map<string, string>();
      for (const c of (completionsRes.data ?? []) as any[]) {
        if (c.completed_at) compByKey.set(`${c.week_index}:${c.day_index}`, c.completed_at);
      }
      const from = opts?.fromDate ?? null;
      const to = opts?.toDate ?? null;
      const out: WorkoutScheduleDay[] = [];
      for (const s of schedule ?? []) {
        if (from && s.date < from) continue;
        if (to && s.date > to) continue;
        const key = `${s.week}:${s.day}`;
        const completedAt = compByKey.get(key) ?? null;
        out.push({
          id: encodeDayId(s.week, s.day),
          date: s.date,
          week: s.week,
          day: s.day,
          title: titleByKey.get(key) ?? null,
          blockId: null,
          blockName: null,
          completed: !!completedAt,
          completedAt,
        });
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    },
    async listCompletions(opts): Promise<WorkoutCompletion[]> {
      const { data, error } = await supabase
        .from("member_workout_completions")
        .select("id, week_index, day_index, completed_at")
        .eq("enrollment_id", enrollmentId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(opts?.limit ?? 200);
      if (error) throw new Error(error.message);
      return (data ?? []).map((c: any) => ({
        id: c.id,
        dayId: encodeDayId(c.week_index, c.day_index),
        week: c.week_index,
        day: c.day_index,
        completedAt: c.completed_at,
      }));
    },
    async reschedule(input: RescheduleInput): Promise<void> {
      if (input.scope !== "this_workout_only") {
        // Scope-aware fan-out lands with the WorkoutScheduleSection in Phase 4.
        throw new NotImplemented(`reschedule:${input.scope}`, "member");
      }
      const { week, day } = decodeDayId(input.dayId);
      await rescheduleDay({
        data: {
          enrollmentId,
          weekIndex: week,
          dayIndex: day,
          scheduledDate: input.newDate,
        },
      });
    },
    async logSet(input: LogSetInput): Promise<void> {
      const { week, day } = decodeDayId(input.dayId);
      // rowId on the member side encodes the exercise index — shared UI
      // generates rowId as `"ex:<index>"` so the adapter can decode.
      const exerciseIndex = (() => {
        const m = /^ex:(\d+)$/.exec(input.rowId);
        if (!m) throw new Error(`member adapter: rowId must be "ex:<index>", got ${input.rowId}`);
        return Number(m[1]);
      })();
      await logSetFn({
        data: {
          enrollmentId,
          weekIndex: week,
          dayIndex: day,
          exerciseIndex,
          setIndex: input.setIndex,
          reps: input.reps ?? null,
          load_lb: input.loadLb ?? null,
          rpe: input.rpe ?? null,
          rir: input.rir ?? null,
          notes: input.notes ?? null,
        },
      });
    },
    async completeDay(dayId: string): Promise<void> {
      const { week, day } = decodeDayId(dayId);
      await completeWorkout({
        data: { enrollmentId, weekIndex: week, dayIndex: day },
      });
    },

    /* ---- Phase B day-view surface (filled in Phase C). ---- */
    async getDay(_dayId: string): Promise<WorkoutDay> { throw new NotImplemented("getDay", "member"); },
    async listRows(_dayId: string): Promise<ExerciseRowDTO[]> { throw new NotImplemented("listRows", "member"); },
    async listRowResults(_dayId: string): Promise<RowResultDTO[]> { throw new NotImplemented("listRowResults", "member"); },
    async listExerciseNotes(_dayId: string): Promise<ExerciseNoteDTO[]> { throw new NotImplemented("listExerciseNotes", "member"); },
    async listExerciseHistory(_exerciseId: string): Promise<HistoryEntryDTO[]> { throw new NotImplemented("listExerciseHistory", "member"); },
    async listClientMaxes(): Promise<MaxEntryDTO[]> { return []; },
    async getDayCompletion(_dayId: string): Promise<DayCompletionDTO | null> { throw new NotImplemented("getDayCompletion", "member"); },
    async getRowBlockSummaries(_rowIds: string[]): Promise<RowBlockSummaryDTO[]> { return []; },
    async listCoachPainFlags(_dayId: string): Promise<CoachPainFlagDTO[]> { return []; },
    async upsertRowResult(_input: UpsertRowResultInput): Promise<string> { throw new NotImplemented("upsertRowResult", "member"); },
    async deleteRowResult(_id: string): Promise<void> { throw new NotImplemented("deleteRowResult", "member"); },
    async upsertExerciseNote(_input: UpsertExerciseNoteInput): Promise<void> { throw new NotImplemented("upsertExerciseNote", "member"); },
    async updateDayCompletion(_dayId: string, _patch: DayCompletionPatch): Promise<void> { throw new NotImplemented("updateDayCompletion", "member"); },
    async saveExerciseUnitPref(_input: { exerciseId: string; unit: "lb" | "kg" }): Promise<void> { /* members default to lb; no-op */ },
    async notifyCoachOfFailure(_input: { dayId: string; reason: string }): Promise<void> { /* routed via member support thread in Phase C */ },
  };
}