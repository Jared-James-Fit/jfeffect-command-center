import { supabase } from "@/integrations/supabase/client";
import type { WorkoutItem } from "@/lib/workout-today";
import { mergeScheduledInstances } from "@/lib/scheduled-instances-merge";
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { isInactivePrimaryDay } from "@/lib/active-calendar";

/**
 * Lightweight dashboard variant of getClientWorkouts.
 * Returns only the day/week/block/completion data needed for
 * computeTodayState, without the heavy exercise row result joins.
 */
export async function getClientTodayItems(clientId: string): Promise<WorkoutItem[]> {
  const { data: allBlocks } = await supabase
    .from("pl_blocks")
    .select("id, client_id, name, status, sort_order, created_at, client_visible, source_template_block_key")
    .eq("client_id", clientId)
    .eq("client_visible", true)
    .neq("status", "Archived")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  // Reserved At-Home Backup blocks never drive Today / primary completion.
  const blocks = filterPrimaryProgramBlocks(allBlocks ?? []);
  const blockIds = blocks.map((b: any) => b.id);
  if (!blockIds.length) return [];

  const { data: weeks } = await supabase
    .from("pl_weeks")
    .select("*")
    .in("block_id", blockIds)
    .order("week_index");

  const weekIds = (weeks ?? []).map((w: any) => w.id);
  if (!weekIds.length) return [];

  const { data: allDays } = await supabase
    .from("pl_days")
    .select("*")
    .in("week_id", weekIds)
    .order("day_index");

  // Archived / soft-deleted days never drive Today.
  const days = (allDays ?? []).filter((d: any) => !isInactivePrimaryDay(d));
  const dayIds = days.map((d: any) => d.id);
  if (!dayIds.length) return [];

  const [completionsRes, scheduledInstancesRes] = await Promise.all([
    supabase
      .from("pl_day_completions")
      .select("*")
      .in("day_id", dayIds)
      .eq("client_id", clientId),
    // Phase 2a: instance-level schedule for the dashboard.
    (supabase.from("pl_scheduled_workouts") as any)
      .select("id, client_id, source_day_id, scheduled_date, scheduled_time, order_index, schedule_source, note, created_at")
      .eq("client_id", clientId)
      .in("source_day_id", dayIds),
  ]);
  const { data: completions } = completionsRes;
  const { data: scheduledInstances } = scheduledInstancesRes;

  const daysByWeek = new Map<string, any[]>();
  for (const d of days) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }

  const baseItems: WorkoutItem[] = [];
  for (const w of weeks ?? []) {
    const b = (blocks ?? []).find((x: any) => x.id === w.block_id);
    const weekDays = daysByWeek.get(w.id) ?? [];
    for (const d of weekDays) {
      baseItems.push({
        day: d,
        week: w,
        block: b,
        completion: null, // merge attaches per-instance / legacy completion
        logged_sets_count: 0,
      });
    }
  }
  return mergeScheduledInstances({
    items: baseItems,
    instances: (scheduledInstances ?? []) as any[],
    completions: (completions ?? []) as any[],
  });
}
