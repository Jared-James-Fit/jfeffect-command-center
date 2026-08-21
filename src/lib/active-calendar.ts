import { deriveBlockStatuses, todayISOLocal } from "@/lib/block-status";

/**
 * Which blocks belong on the CURRENT workout calendar.
 *
 * The workouts calendar is a "what am I training now / next" surface. Once a
 * block is finished (canonical status Completed or Archived), its days must
 * stop populating the week/month grid — otherwise old blocks stack historical
 * workouts onto the same weekday cells as the live block and everything looks
 * duplicated.
 *
 * This is derived generically from block state (see block-status.ts), never
 * from client ids or block names. Completed workouts INSIDE the active block
 * are untouched — they stay on their real historical dates. Completed blocks
 * remain fully accessible via block/history/archive surfaces, which do not use
 * this filter.
 */
const CALENDAR_STATUSES = new Set(["Active", "Upcoming", "Draft"]);

export function activeCalendarBlockIds(blocks: any[], today: string = todayISOLocal()): Set<string> {
  const statuses = deriveBlockStatuses(blocks ?? [], today);
  const ids = new Set<string>();
  for (const b of blocks ?? []) {
    if (!b?.id) continue;
    if (CALENDAR_STATUSES.has(statuses.get(b.id) ?? "")) ids.add(b.id);
  }
  return ids;
}

/** Keep only items whose block is currently active/upcoming. */
export function filterActiveCalendarItems<T extends { block?: any }>(
  items: T[],
  today: string = todayISOLocal(),
): T[] {
  const blocks = new Map<string, any>();
  for (const it of items ?? []) {
    const b = (it as any)?.block;
    if (b?.id && !blocks.has(b.id)) blocks.set(b.id, b);
  }
  if (!blocks.size) return items ?? [];
  const keep = activeCalendarBlockIds([...blocks.values()], today);
  return (items ?? []).filter((it) => {
    const id = (it as any)?.block?.id;
    if (!id) return true;
    return keep.has(id);
  });
}

/** A pl_days row that must not render on active workout surfaces. */
export function isInactivePrimaryDay(day: any): boolean {
  return !!day?.archived || day?.deleted_at != null;
}
