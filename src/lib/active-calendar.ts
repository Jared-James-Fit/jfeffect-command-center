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

/**
 * HISTORY CONTRACT (2026-08-27)
 * -----------------------------
 * The calendar is a historical training timeline, not just a "what's next"
 * surface. Completed / archived blocks must keep rendering the workouts that
 * genuinely happened, on their real dates.
 *
 * The original reason completed blocks were filtered out entirely was the
 * cadence fallback: a finished block with no real dates would be re-derived
 * onto the CURRENT committed weekdays and stack duplicates on live cells.
 *
 * So the rule is anchoring, not recency:
 *   - Active / Upcoming / Draft block → render as today (cadence fallback ok).
 *   - Any other block (Completed, Archived, ended program) → render ONLY when
 *     the item is anchored to a real historical date: a canonical
 *     pl_scheduled_workouts instance, a legacy pl_days.scheduled_date, or a
 *     completion timestamp. Never cadence-derived.
 */
export function historicalAnchorDate(item: any): string | null {
  const explicit = item?.scheduledDate ?? item?.day?.scheduled_date ?? null;
  if (explicit) return String(explicit).slice(0, 10);
  const completedAt = item?.completion?.completed_at ?? null;
  if (!completedAt) return null;
  const d = new Date(completedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True when this item belongs to a finished/archived block but really happened. */
export function isAnchoredHistoricalItem(item: any): boolean {
  return historicalAnchorDate(item) != null;
}

/**
 * Calendar dataset = live blocks (as before) + anchored historical workouts
 * from previous programs/blocks. Replaces filterActiveCalendarItems on
 * calendar surfaces; the old helper stays for "current schedule only" callers.
 */
export function filterCalendarItemsWithHistory<T extends { block?: any }>(
  items: T[],
  today: string = todayISOLocal(),
): T[] {
  const blocks = new Map<string, any>();
  for (const it of items ?? []) {
    const b = (it as any)?.block;
    if (b?.id && !blocks.has(b.id)) blocks.set(b.id, b);
  }
  if (!blocks.size) return items ?? [];
  const live = activeCalendarBlockIds([...blocks.values()], today);
  return (items ?? []).filter((it) => {
    const id = (it as any)?.block?.id;
    if (!id) return true;
    if (live.has(id)) return true;
    return isAnchoredHistoricalItem(it);
  });
}
