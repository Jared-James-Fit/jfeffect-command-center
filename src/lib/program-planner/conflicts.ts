/**
 * Compute conflicts between incoming placements and the client's existing
 * programming + completion log.
 *
 * Pure: takes already-fetched arrays so it stays trivially testable.
 */
import type { PlannerConflict, PlannerPlacement } from "./types";

export interface ExistingScheduledDay {
  dayId: string;
  blockId: string;
  blockName?: string | null;
  title?: string | null;
  scheduled_date: string;        // ISO yyyy-mm-dd
  schedule_locked?: boolean;
  completed?: boolean;
}

export interface ExistingBlockWindow {
  blockId: string;
  name?: string | null;
  start_date: string | null;
  end_date: string | null;
  status?: string | null;
}

export function detectConflicts(input: {
  placements: PlannerPlacement[];
  existingDays: ExistingScheduledDay[];
  existingBlocks: ExistingBlockWindow[];
}): PlannerConflict[] {
  const conflicts: PlannerConflict[] = [];
  const byDate = new Map<string, ExistingScheduledDay[]>();
  for (const d of input.existingDays) {
    const k = d.scheduled_date;
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(d);
  }

  // 1. Per-placement checks.
  const incomingByDate = new Map<string, PlannerPlacement[]>();
  for (const p of input.placements) {
    if (!p.date) {
      conflicts.push({
        type: "no_date",
        date: null,
        incoming: { dayKey: p.dayKey, title: p.title },
      });
      continue;
    }
    if (!incomingByDate.has(p.date)) incomingByDate.set(p.date, []);
    incomingByDate.get(p.date)!.push(p);

    const existing = byDate.get(p.date) ?? [];
    for (const ex of existing) {
      if (ex.completed) {
        conflicts.push({
          type: "completed_protected",
          date: p.date,
          incoming: { dayKey: p.dayKey, title: p.title },
          existing: { dayId: ex.dayId, blockId: ex.blockId, label: ex.title ?? ex.blockName ?? "Completed workout", completed: true },
        });
      } else if (ex.schedule_locked) {
        conflicts.push({
          type: "locked_destination",
          date: p.date,
          incoming: { dayKey: p.dayKey, title: p.title },
          existing: { dayId: ex.dayId, blockId: ex.blockId, label: ex.title ?? ex.blockName ?? "Locked workout", locked: true },
        });
      } else {
        conflicts.push({
          type: "date_occupied",
          date: p.date,
          incoming: { dayKey: p.dayKey, title: p.title },
          existing: { dayId: ex.dayId, blockId: ex.blockId, label: ex.title ?? ex.blockName ?? "Scheduled workout" },
        });
      }
    }
  }

  // 2. Two incoming placements landing on the same date.
  for (const [date, list] of incomingByDate) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) {
      conflicts.push({
        type: "duplicate_incoming",
        date,
        incoming: { dayKey: list[i].dayKey, title: list[i].title },
        existing: { label: `${list[0].title} (also assigned to this date)` },
      });
    }
  }

  // 3. Block-window overlap (only when we have date bounds).
  const placedDates = input.placements.map((p) => p.date).filter(Boolean) as string[];
  if (placedDates.length) {
    placedDates.sort();
    const incomingStart = placedDates[0];
    const incomingEnd = placedDates[placedDates.length - 1];
    for (const b of input.existingBlocks) {
      if (!b.start_date || !b.end_date) continue;
      if (b.start_date <= incomingEnd && b.end_date >= incomingStart) {
        conflicts.push({
          type: "block_overlap",
          date: b.start_date,
          incoming: { dayKey: "__window__", title: "Incoming window" },
          existing: { blockId: b.blockId, label: b.name ?? "Existing block" },
        });
      }
    }
  }

  return conflicts;
}