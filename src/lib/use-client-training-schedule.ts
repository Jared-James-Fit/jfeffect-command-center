/**
 * One read for the client Training Program board.
 *
 * Returns the client's blocks with canonical derived statuses plus every
 * workout placed on the calendar (instance date first, legacy pl_days mirror
 * only as a fallback) and its completion state. Schedule truth = WHEN, program
 * = WHAT, completion = WHAT HAPPENED.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listClientBlocks, listClientPreps } from "@/lib/pl-programs";
import { deriveSchedule, todayISO, type ScheduleBlock } from "@/lib/block-schedule-model";

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
};

export function clientTrainingScheduleKey(clientId: string) {
  return ["client-training-schedule", clientId] as const;
}

export function useClientTrainingSchedule(clientId: string) {
  return useQuery({
    queryKey: clientTrainingScheduleKey(clientId),
    queryFn: async (): Promise<ClientTrainingSchedule> => {
      const [rawBlocks, preps] = await Promise.all([
        listClientBlocks(clientId),
        listClientPreps(clientId),
      ]);
      const blocks = deriveSchedule((rawBlocks ?? []) as any[], todayISO());
      const blockIds = blocks.map((b) => b.id);
      if (!blockIds.length) return { blocks, preps: preps ?? [], workouts: [] };

      const { data: dayRows } = await (supabase as any)
        .from("pl_days")
        .select("id, title, day_index, scheduled_date, archived, deleted_at, pl_weeks!inner(id, block_id, week_index)")
        .in("pl_weeks.block_id", blockIds);
      const days = ((dayRows ?? []) as any[]).filter((d) => !d.archived && !d.deleted_at);
      const dayIds = days.map((d) => d.id);
      if (!dayIds.length) return { blocks, preps: preps ?? [], workouts: [] };

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
      const blockName = new Map(blocks.map((b) => [b.id, b.name ?? null]));
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
          blockName: blockName.get(bId) ?? null,
          date: String(date).slice(0, 10),
          title: d.title ?? `Day ${d.day_index ?? ""}`.trim(),
          completed: completedDays.has(d.id),
        });
      }
      workouts.sort((a, b) => a.date.localeCompare(b.date));
      return { blocks, preps: preps ?? [], workouts };
    },
    enabled: !!clientId,
  });
}
