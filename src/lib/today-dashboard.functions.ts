import { supabase } from "@/integrations/supabase/client";
import type { WorkoutItem } from "@/lib/workout-today";

/**
 * Lightweight dashboard variant of getClientWorkouts.
 * Returns only the day/week/block/completion data needed for
 * computeTodayState, without the heavy exercise row result joins.
 */
export async function getClientTodayItems(clientId: string): Promise<WorkoutItem[]> {
  const { data: blocks } = await supabase
    .from("pl_blocks")
    .select("id, client_id, name, status, sort_order, created_at, client_visible")
    .eq("client_id", clientId)
    .eq("client_visible", true)
    .neq("status", "Archived")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  const blockIds = (blocks ?? []).map((b: any) => b.id);
  if (!blockIds.length) return [];

  const { data: weeks } = await supabase
    .from("pl_weeks")
    .select("*")
    .in("block_id", blockIds)
    .order("week_index");

  const weekIds = (weeks ?? []).map((w: any) => w.id);
  if (!weekIds.length) return [];

  const { data: days } = await supabase
    .from("pl_days")
    .select("*")
    .in("week_id", weekIds)
    .order("day_index");

  const dayIds = (days ?? []).map((d: any) => d.id);
  if (!dayIds.length) return [];

  const { data: completions } = await supabase
    .from("pl_day_completions")
    .select("*")
    .in("day_id", dayIds)
    .eq("client_id", clientId);

  const completionsByDay = new Map((completions ?? []).map((c: any) => [c.day_id, c]));

  const daysByWeek = new Map<string, any[]>();
  for (const d of days ?? []) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }

  const items: WorkoutItem[] = [];
  for (const w of weeks ?? []) {
    const b = (blocks ?? []).find((x: any) => x.id === w.block_id);
    const weekDays = daysByWeek.get(w.id) ?? [];
    for (const d of weekDays) {
      items.push({
        day: d,
        week: w,
        block: b,
        completion: completionsByDay.get(d.id) ?? null,
        logged_sets_count: 0,
      });
    }
  }
  return items;
}
