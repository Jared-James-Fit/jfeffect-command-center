/**
 * Map materialized days onto real calendar dates given an assignment method.
 *
 * Pure function — no I/O. Called by the dry-run planner and by the commit
 * function to keep client preview and server commit in agreement.
 */
import type {
  AssignmentMethod, PlannerPlacement, Weekday,
} from "./types";
import type { MaterializedDay } from "./selection";

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseISO(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export interface PlacementInput {
  method: AssignmentMethod;
  startDate: string | null;
  trainingDays: Weekday[];
  manualDateMap?: Record<string, string>;
  /** Existing dates that are NOT empty (used by fill_empty / insert). */
  occupiedDates?: Set<string>;
  days: MaterializedDay[];
}

export function computePlacements(input: PlacementInput): PlannerPlacement[] {
  const { method, startDate, trainingDays, manualDateMap, days } = input;
  const occupied = input.occupiedDates ?? new Set<string>();

  const base = (md: MaterializedDay, date: string | null): PlannerPlacement => ({
    dayKey: md.dayKey,
    blockKey: md.blockKey,
    weekIndex: md.weekIndex,
    dayIndex: md.dayIndex,
    title: md.title,
    exerciseKeys: md.exerciseKeys,
    date,
  });

  if (method === "manual_dates") {
    return days.map((md) => base(md, manualDateMap?.[md.dayKey] ?? null));
  }

  if (!startDate) return days.map((md) => base(md, null));

  const start = parseISO(startDate);

  if (method === "entire_sequence") {
    // Walk forward day-by-day, preserving the in-template order (skips no dates).
    return days.map((md, i) => base(md, toISO(addDays(start, i))));
  }

  if (
    method === "weekday_map" ||
    method === "client_days" ||
    method === "fill_empty" ||
    method === "insert" ||
    method === "replace_range"
  ) {
    // Find the next matching weekday >= start, then advance through the
    // selected weekdays in order, wrapping into following weeks.
    if (!trainingDays.length) return days.map((md) => base(md, null));
    const indexSet = new Set(trainingDays.map((d) => WEEKDAY_INDEX[d]));
    const out: PlannerPlacement[] = [];
    let cursor = new Date(start.getTime());
    let placed = 0;
    // Cap the walk to avoid runaway loops on bad input.
    const HARD_LIMIT = days.length * 30 + 365;
    let steps = 0;
    while (placed < days.length && steps++ < HARD_LIMIT) {
      const dow = cursor.getUTCDay();
      const iso = toISO(cursor);
      if (indexSet.has(dow)) {
        if (method === "fill_empty" && occupied.has(iso)) {
          // Skip occupied dates only — keep advancing.
        } else {
          out.push(base(days[placed], iso));
          placed++;
        }
      }
      cursor = addDays(cursor, 1);
    }
    while (placed < days.length) {
      out.push(base(days[placed], null));
      placed++;
    }
    return out;
  }

  // Default: contiguous sequence.
  return days.map((md, i) => base(md, toISO(addDays(start, i))));
}

export function lastPlacedDate(placements: PlannerPlacement[]): string | null {
  let best: string | null = null;
  for (const p of placements) {
    if (!p.date) continue;
    if (!best || p.date > best) best = p.date;
  }
  return best;
}