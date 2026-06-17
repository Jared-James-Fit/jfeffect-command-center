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
  };
}