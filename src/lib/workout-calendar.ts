// A client's workouts by calendar date (yyyy-MM-dd → items), the way their
// Workouts calendar shows them. Shared by the client's Workouts screen and
// the coach's workout peek in the messenger so both put every workout on the
// same day.
//
// The calendar is a historical timeline: live (active/upcoming) blocks plus
// anchored workouts from previous/completed/archived programs. Old blocks are
// only placed on dates they actually own (instance / legacy scheduled_date /
// completion), never re-derived from the current committed cadence. Several
// workouts can share a date (e.g. a reschedule stacks Day 2 onto Friday), so
// each date holds a list and nothing is silently dropped.
import { activeCalendarBlockIds, filterCalendarItemsWithHistory, historicalAnchorDate } from "@/lib/active-calendar";
import { toLocalISO } from "@/lib/today";
import { dayScheduledDate, type WorkoutItem } from "@/lib/workout-today";

export function buildWorkoutDateMap(
  items: WorkoutItem[],
  committedTrainingDays: string[] | null | undefined,
): Map<string, WorkoutItem[]> {
  const dayItems = (items ?? []).filter((it) => it.day?.id);
  const blocks = new Map<string, any>();
  for (const it of dayItems) if (it.block?.id && !blocks.has(it.block.id)) blocks.set(it.block.id, it.block);
  const liveBlockIds = activeCalendarBlockIds([...blocks.values()]);

  const map = new Map<string, WorkoutItem[]>();
  for (const it of filterCalendarItemsWithHistory(dayItems)) {
    const historical = !!it.block?.id && !liveBlockIds.has(it.block.id);
    let key: string;
    if (historical) {
      const anchor = historicalAnchorDate(it);
      if (!anchor) continue;
      key = anchor;
    } else {
      const d = dayScheduledDate(it, committedTrainingDays ?? null);
      if (!d) continue;
      key = toLocalISO(d);
    }
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  return map;
}
