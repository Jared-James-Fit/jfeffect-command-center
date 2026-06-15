import { todayLocalISO } from "@/lib/today";
// Helpers for detecting overlap between training blocks already assigned to a client
// and suggesting the next available start date.

export type ScheduledBlock = {
  id: string;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  archived?: boolean | null;
};

const isActiveLike = (b: ScheduledBlock) =>
  !b.archived && b.status !== "Archived" && b.status !== "Completed";

export function parseISODate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Returns the first existing block that overlaps with [start, end], ignoring blockId. */
export function findOverlappingBlock(
  blocks: ScheduledBlock[],
  startISO: string | null | undefined,
  endISO: string | null | undefined,
  ignoreId?: string,
): ScheduledBlock | null {
  const s = parseISODate(startISO ?? null);
  const e = parseISODate(endISO ?? null) ?? s;
  if (!s || !e) return null;
  for (const b of blocks) {
    if (ignoreId && b.id === ignoreId) continue;
    if (!isActiveLike(b)) continue;
    const bs = parseISODate(b.start_date);
    const be = parseISODate(b.end_date) ?? bs;
    if (!bs || !be) continue;
    // overlap if ranges intersect (inclusive)
    if (s <= be && e >= bs) return b;
  }
  return null;
}

/** Suggested next start = day after the latest non-archived end_date, or today if none. */
export function suggestNextStartISO(blocks: ScheduledBlock[]): string {
  const today = todayLocalISO();
  let latest: string | null = null;
  for (const b of blocks) {
    if (!isActiveLike(b)) continue;
    const end = b.end_date ?? null;
    if (!end) continue;
    if (!latest || end > latest) latest = end;
  }
  if (!latest) return today;
  const next = addDaysISO(latest, 1);
  return next > today ? next : today;
}