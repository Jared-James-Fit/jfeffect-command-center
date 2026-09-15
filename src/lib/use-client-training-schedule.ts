/**
 * One read for the client Training Program board.
 *
 * Returns the client's blocks with canonical derived statuses plus every
 * workout placed on the calendar (instance date first, legacy pl_days mirror
 * only as a fallback) and its completion state. Schedule truth = WHEN, program
 * = WHAT, completion = WHAT HAPPENED.
 *
 * The calendar rows are read BEFORE statuses are derived, because they are the
 * same source that drives the client's own workout calendar / Client POV. A
 * block that still has outstanding scheduled workouts is the current block
 * even when its declared `end_date` has passed or its `status` column was
 * flipped to Completed by another flow.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listClientBlocks, listClientPreps } from "@/lib/pl-programs";
import {
  deriveSchedule, buildEvidence, currentAssignmentId, todayISO,
  type ScheduleBlock, type EvidenceMap,
} from "@/lib/block-schedule-model";

export type CalendarWorkout = {
  id: string;
  dayId: string;
  instanceId: string | null;
  blockId: string;
  blockName: string | null;
  date: string;
  title: string;
  completed: boolean;
};

export type ClientTrainingSchedule = {
  blocks: ScheduleBlock[];
  preps: any[];
  workouts: CalendarWorkout[];
  /** prep_id of the assignment the client is actually training under */
  currentAssignmentId: string | null;
  /** next scheduled, incomplete workout of the current block */
  nextWorkout: CalendarWorkout | null;
  evidence: EvidenceMap;
};

export function clientTrainingScheduleKey(clientId: string) {
  return ["client-training-schedule", clientId] as const;
}

export function useClientTrainingSchedule(clientId: string) {
  return useQuery({
    queryKey: clientTrainingScheduleKey(clientId),
    queryFn: async (): Promise<ClientTrainingSchedule> => {
      const today = todayISO();
      const [rawBlocks, preps] = await Promise.all([
        listClientBlocks(clientId),
        listClientPreps(clientId),
      ]);
      const blockList = (rawBlocks ?? []) as any[];
      const empty = (blocks: ScheduleBlock[]): ClientTrainingSchedule => ({
        blocks,
        preps: preps ?? [],
        workouts: [],
        currentAssignmentId: currentAssignmentId(blocks),
        nextWorkout: null,
        evidence: new Map(),
      });

      const blockIds = blockList.map((b) => b.id);
      if (!blockIds.length) return empty(deriveSchedule(blockList, today));

      const { data: dayRows } = await (supabase as any)
        .from("pl_days")
        .select("id, title, day_index, scheduled_date, archived, deleted_at, pl_weeks!inner(id, block_id, week_index)")
        .in("pl_weeks.block_id", blockIds);
      const days = ((dayRows ?? []) as any[]).filter((d) => !d.archived && !d.deleted_at);
      const dayIds = days.map((d) => d.id);
      if (!dayIds.length) return empty(deriveSchedule(blockList, today));

      const [{ data: instances }, { data: completions }] = await Promise.all([
        (supabase as any)
          .from("pl_scheduled_workouts")
          .select("id, source_day_id, scheduled_date")
          .eq("client_id", clientId)
          .in("source_day_id", dayIds),
        (supabase as any)
          .from("pl_day_completions")
          .select("day_id, scheduled_workout_id, completed_at")
          .eq("client_id", clientId)
          .in("day_id", dayIds),
      ]);

      const completedDays = new Set(
        ((completions ?? []) as any[]).filter((c) => c.completed_at).map((c) => c.day_id),
      );
      const rawName = new Map(blockList.map((b) => [b.id, b.name ?? null]));
      const instanceByDay = new Map<string, any>();
      for (const inst of (instances ?? []) as any[]) instanceByDay.set(inst.source_day_id, inst);

      const workouts: CalendarWorkout[] = [];
      for (const d of days) {
        const inst = instanceByDay.get(d.id);
        const date = inst?.scheduled_date ?? d.scheduled_date ?? null;
        if (!date) continue;
        const bId = d.pl_weeks?.block_id as string;
        workouts.push({
          id: inst?.id ?? d.id,
          dayId: d.id,
          instanceId: inst?.id ?? null,
          blockId: bId,
          blockName: rawName.get(bId) ?? null,
          date: String(date).slice(0, 10),
          title: d.title ?? `Day ${d.day_index ?? ""}`.trim(),
          completed: completedDays.has(d.id),
        });
      }
      workouts.sort((a, b) => a.date.localeCompare(b.date));

      // Calendar evidence feeds the status derivation — never the other way round.
      const evidence = buildEvidence(workouts, today);
      const blocks = deriveSchedule(blockList, today, evidence);
      const current = blocks.find((b) => b.status_derived === "Active") ?? null;
      const nextWorkout =
        workouts.find((w) => !w.completed && w.date >= today && (!current || w.blockId === current.id)) ??
        workouts.find((w) => !w.completed && w.date >= today) ??
        null;

      return {
        blocks,
        preps: preps ?? [],
        workouts,
        currentAssignmentId: currentAssignmentId(blocks),
        nextWorkout,
        evidence,
      };
    },
    enabled: !!clientId,
  });
}
