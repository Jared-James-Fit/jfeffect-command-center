/**
 * What the client's Training tab (admin) says about their program: the
 * roadmap rows and the few things that need the coach. Pure, so the card
 * and its tests read it the same way.
 */
import {
  currentBlock, upcomingBlocks, draftBlocks, historyBlocks, findOverlaps, daysBetween,
  blockGap, blockCoverEnd, blockCoverStart,
  type ScheduleBlock,
} from "@/lib/block-schedule-model";
import type { UnscheduledWorkout } from "@/lib/use-client-training-schedule";

/** Days before a block's end that "nothing planned after" starts showing. */
export const ENDS_SOON_DAYS = 14;

export type TrainingRoadmap = {
  current: ScheduleBlock | null;
  /** the current block, then what's planned after it in the same program, by date */
  live: ScheduleBlock[];
  /** built but not on the calendar yet */
  drafts: ScheduleBlock[];
  /** finished, ended early or archived, newest first */
  past: ScheduleBlock[];
};

export function trainingRoadmap(blocks: ScheduleBlock[], assignmentId: string | null): TrainingRoadmap {
  const current = currentBlock(blocks);
  const inProgram = (b: ScheduleBlock) => !assignmentId || !b.prep_id || b.prep_id === assignmentId;
  const upcoming = upcomingBlocks(blocks)
    .filter(inProgram)
    .slice()
    .sort((a, b) => (a.effective_start ?? "").localeCompare(b.effective_start ?? ""));
  return {
    current,
    live: [...(current ? [current] : []), ...upcoming],
    drafts: draftBlocks(blocks),
    past: historyBlocks(blocks),
  };
}

export type TrainingAlert =
  /** dated program blocks the client can't see: Start puts them on (visible, workouts on their training days) */
  | { kind: "hidden"; blocks: ScheduleBlock[] }
  | { kind: "unscheduled"; count: number }
  | { kind: "ends_soon"; end: string; daysLeft: number }
  /** training days with nothing planned between the current block and the next; Fix dates starts the next one on `suggestedStart` */
  | { kind: "gap"; days: number; suggestedStart: string | null }
  | { kind: "overlap"; a: string; b: string };

/** Dated blocks still hidden from the client (a program they can't see, however it's dated). */
export function hiddenLiveBlocks(roadmap: TrainingRoadmap): ScheduleBlock[] {
  return roadmap.live.filter((b) => b.client_visible === false);
}

/**
 * Workouts on a live block with no date: the current block from this week on,
 * every upcoming block. A draft has none by design (it isn't on the calendar
 * yet), a finished week is history, and a hidden block's are placed when it's
 * started (its own alert).
 */
export function unscheduledCount(roadmap: TrainingRoadmap, unscheduled: UnscheduledWorkout[]): number {
  const liveIds = new Map(roadmap.live.map((b) => [b.id, b]));
  return unscheduled.filter((u) => {
    const b = liveIds.get(u.blockId);
    if (!b || b.client_visible === false) return false;
    if (b.status_derived === "Active" && b.week_of) return u.weekIndex >= b.week_of;
    return true;
  }).length;
}

/** The few things on the program that need the coach, most urgent first. */
export function trainingAlerts(input: {
  blocks: ScheduleBlock[];
  roadmap: TrainingRoadmap;
  unscheduled: UnscheduledWorkout[];
  today: string;
  /** the client's training days: a gap is only a day they'd train on */
  trainingDays?: readonly string[] | null;
}): TrainingAlert[] {
  const { roadmap, today } = input;
  const out: TrainingAlert[] = [];
  const hidden = hiddenLiveBlocks(roadmap);
  if (hidden.length) out.push({ kind: "hidden", blocks: hidden });
  const count = unscheduledCount(roadmap, input.unscheduled);
  if (count > 0) out.push({ kind: "unscheduled", count });

  const current = roadmap.current;
  const next = roadmap.live[1] ?? null;
  const end = current?.effective_end ?? null;
  if (current && end && !next) {
    const daysLeft = daysBetween(today, end);
    if (daysLeft >= 0 && daysLeft <= ENDS_SOON_DAYS) out.push({ kind: "ends_soon", end, daysLeft });
  }
  if (current && next) {
    // what each block covers (its weeks or its workouts), counting only days they train on
    const gap = blockGap(blockCoverEnd(current), blockCoverStart(next), input.trainingDays);
    if (gap.days > 0) out.push({ kind: "gap", days: gap.days, suggestedStart: gap.suggestedStart });
  }
  const overlap = findOverlaps(input.blocks)[0];
  if (overlap) out.push({ kind: "overlap", a: overlap.a.name ?? "A block", b: overlap.b.name ?? "another block" });
  return out;
}
