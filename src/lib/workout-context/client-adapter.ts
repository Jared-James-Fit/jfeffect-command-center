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
} from "./types";
import { getClientSchedule, applyBulkScheduleChange } from "@/lib/schedule-bulk.functions";

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
    async logSet(_input: LogSetInput): Promise<void> {
      throw new NotImplemented("logSet", "client");
    },
    async completeDay(_dayId: string): Promise<void> {
      throw new NotImplemented("completeDay", "client");
    },

    /* ---- Phase B day-view surface (stubs filled in Phase B). ---- */
    async getDay(_dayId: string): Promise<WorkoutDay> { throw new NotImplemented("getDay", "client"); },
    async listRows(_dayId: string): Promise<ExerciseRowDTO[]> { throw new NotImplemented("listRows", "client"); },
    async listRowResults(_dayId: string): Promise<RowResultDTO[]> { throw new NotImplemented("listRowResults", "client"); },
    async listExerciseNotes(_dayId: string): Promise<ExerciseNoteDTO[]> { throw new NotImplemented("listExerciseNotes", "client"); },
    async listExerciseHistory(_exerciseId: string): Promise<HistoryEntryDTO[]> { throw new NotImplemented("listExerciseHistory", "client"); },
    async listClientMaxes(): Promise<MaxEntryDTO[]> { throw new NotImplemented("listClientMaxes", "client"); },
    async getDayCompletion(_dayId: string): Promise<DayCompletionDTO | null> { throw new NotImplemented("getDayCompletion", "client"); },
    async getRowBlockSummaries(_rowIds: string[]): Promise<RowBlockSummaryDTO[]> { throw new NotImplemented("getRowBlockSummaries", "client"); },
    async listCoachPainFlags(_dayId: string): Promise<CoachPainFlagDTO[]> { throw new NotImplemented("listCoachPainFlags", "client"); },
    async upsertRowResult(_input: UpsertRowResultInput): Promise<string> { throw new NotImplemented("upsertRowResult", "client"); },
    async deleteRowResult(_id: string): Promise<void> { throw new NotImplemented("deleteRowResult", "client"); },
    async upsertExerciseNote(_input: UpsertExerciseNoteInput): Promise<void> { throw new NotImplemented("upsertExerciseNote", "client"); },
    async updateDayCompletion(_dayId: string, _patch: DayCompletionPatch): Promise<void> { throw new NotImplemented("updateDayCompletion", "client"); },
    async saveExerciseUnitPref(_input: { exerciseId: string; unit: "lb" | "kg" }): Promise<void> { throw new NotImplemented("saveExerciseUnitPref", "client"); },
    async notifyCoachOfFailure(_input: { dayId: string; reason: string }): Promise<void> { throw new NotImplemented("notifyCoachOfFailure", "client"); },
  };
}