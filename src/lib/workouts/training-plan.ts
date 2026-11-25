/**
 * The Training Plan page's timeline (pure, tested in training-plan-page.test.ts):
 * Program → Block → Week → Workout, from the same roadmap the Program card
 * reads (`buildProgramRoadmap`) and the same workouts and dates the calendar
 * shows, so week numbers, dates and "N of M done" agree with the rest of the
 * app. Weeks are numbered across the program, the Full plan's way (`planWeeks`:
 * week 7 of 12, never block 2 week 1), a week's own name never repeats its
 * number (`weekParts`). Done counts leave out optional workouts, like the
 * month's progress. The block today falls in opens expanded, the rest folded;
 * inside it, this week (else the next one to come) opens.
 */
import type { ProgramRoadmap, RoadmapBlockView, RoadmapStatus, RoadmapWeekView } from "@/lib/training-roadmap";

export type PlanDayKind = "done" | "missed" | "progress" | "scheduled" | "skipped";

export type PlanEntry = {
  key: string;
  dayId: string;
  weekId: string | null;
  blockId: string | null;
  /** yyyy-mm-dd it's on the calendar, or null when it has no date */
  iso: string | null;
  title: string;
  kind: PlanDayKind | null;
  /** how far an unfinished workout is (0–100), for its ring */
  pct?: number;
  optional: boolean;
  dayIndex: number;
};

export type PlanWeekRow = {
  id: string;
  /** numbered across the whole program */
  n: number;
  name: string | null;
  focus: string | null;
  start: string | null;
  end: string | null;
  status: RoadmapStatus;
  days: PlanEntry[];
  done: number;
  planned: number;
};

export type PlanBlockRow = {
  id: string;
  /** 1-based, within the program */
  no: number;
  title: string;
  status: RoadmapStatus;
  start: string | null;
  end: string | null;
  purpose: string | null;
  weeks: PlanWeekRow[];
  done: number;
  planned: number;
};

export type PlanTimeline = {
  blocks: PlanBlockRow[];
  /** the block that opens expanded */
  openBlockId: string | null;
  /** the week that opens expanded */
  openWeekId: string | null;
  done: number;
  planned: number;
};

/** "Week 2 · Base volume" → its own name only ("Base volume"); "Week 2" → null. */
export function weekName(w: Pick<RoadmapWeekView, "label">): string | null {
  const label = (w.label ?? "").trim();
  const m = label.match(/^week\s*\d+\s*(?:[·:|\-–—]\s*)?(.*)$/i);
  if (m) return m[1].trim() || null;
  return label || null;
}

/** "Block 1 — Volume 5s/7s" → "Volume 5s/7s": the block by its own name, the roadmap's label first. */
export function blockTitleOf(b: Pick<RoadmapBlockView, "label" | "name">): string {
  if (b.label) return b.label;
  const m = /^(block\s*\d+)\s*[—–:-]\s*(.+)$/i.exec((b.name ?? "").trim());
  return m ? m[2].trim() : b.name;
}

const byDay = (a: PlanEntry, b: PlanEntry) =>
  a.iso && b.iso ? (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.dayIndex - b.dayIndex) : a.iso ? -1 : b.iso ? 1 : a.dayIndex - b.dayIndex;

export function buildPlanTimeline(roadmap: Pick<ProgramRoadmap, "blocks" | "currentBlockId">, entries: PlanEntry[]): PlanTimeline {
  const byWeek = new Map<string, PlanEntry[]>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.weekId || seen.has(e.key)) continue;
    seen.add(e.key);
    byWeek.set(e.weekId, [...(byWeek.get(e.weekId) ?? []), e]);
  }
  let n = 0;
  let done = 0;
  let planned = 0;
  const blocks: PlanBlockRow[] = roadmap.blocks.map((b, i) => {
    let bDone = 0;
    let bPlanned = 0;
    const weeks = b.weeks.map((w): PlanWeekRow => {
      const days = [...(byWeek.get(w.id) ?? [])].sort(byDay);
      const counted = days.filter((d) => !d.optional);
      const wDone = counted.filter((d) => d.kind === "done").length;
      bDone += wDone;
      bPlanned += counted.length;
      return { id: w.id, n: ++n, name: weekName(w), focus: w.focus, start: w.start, end: w.end, status: w.status, days, done: wDone, planned: counted.length };
    });
    done += bDone;
    planned += bPlanned;
    return { id: b.id, no: i + 1, title: blockTitleOf(b), status: b.status, start: b.start, end: b.end, purpose: b.purpose, weeks, done: bDone, planned: bPlanned };
  });
  const openBlock =
    blocks.find((b) => b.id === roadmap.currentBlockId) ??
    blocks.find((b) => b.status !== "completed") ??
    blocks[blocks.length - 1] ??
    null;
  const openWeek = openBlock
    ? openBlock.weeks.find((w) => w.status === "current") ?? openBlock.weeks.find((w) => w.status === "upcoming") ?? null
    : null;
  return { blocks, openBlockId: openBlock?.id ?? null, openWeekId: openWeek?.id ?? null, done, planned };
}
