import { describe, expect, it } from "vitest";
import { blockTitleOf, buildPlanTimeline, weekName, type PlanEntry } from "@/lib/workouts/training-plan";
import type { RoadmapBlockView } from "@/lib/training-roadmap";

const week = (id: string, index: number, status: "completed" | "current" | "upcoming", label: string | null = null) => ({
  id, index, start: null, end: null, status, label, focus: null,
});
const block = (id: string, name: string, status: "completed" | "current" | "upcoming", weeks: ReturnType<typeof week>[]): RoadmapBlockView => ({
  id, name, status, start: null, end: null, weekCount: weeks.length, weeks, label: null, purpose: null, style: null, byCoach: false,
});
const entry = (key: string, weekId: string, iso: string | null, kind: PlanEntry["kind"], optional = false, dayIndex = 1): PlanEntry => ({
  key, dayId: key, weekId, blockId: null, iso, title: key, kind, optional, dayIndex,
});

const roadmap = {
  currentBlockId: "b2",
  blocks: [
    block("b1", "Block 1 — Volume", "completed", [week("w1", 1, "completed", "Week 1 · Ease in"), week("w2", 2, "completed")]),
    block("b2", "Strength", "current", [week("w3", 1, "completed"), week("w4", 2, "current", "Week 4: Build"), week("w5", 3, "upcoming")]),
    block("b3", "Peak", "upcoming", [week("w6", 1, "upcoming")]),
  ],
};

describe("the Training Plan timeline: Program → Block → Week → Workout", () => {
  const t = buildPlanTimeline(roadmap, [
    entry("d1", "w1", "2026-10-05", "done"),
    entry("d2", "w1", "2026-10-07", "missed"),
    entry("d4", "w4", "2026-11-25", "scheduled", false, 2),
    entry("d3", "w4", "2026-11-23", "done", false, 1),
    entry("d5", "w4", "2026-11-24", "done", true),
    entry("d6", "w4", null, "scheduled", false, 4),
    entry("d3", "w4", "2026-11-23", "done"), // the same workout twice (an instance and its day) counts once
  ]);

  it("opens on the block today falls in and this week; the others fold", () => {
    expect(t.openBlockId).toBe("b2");
    expect(t.openWeekId).toBe("w4");
  });

  it("numbers weeks across the program and never repeats a week's number in its name", () => {
    expect(t.blocks.flatMap((b) => b.weeks.map((w) => w.n))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.blocks[0].weeks[0].name).toBe("Ease in");
    expect(t.blocks[1].weeks[1].name).toBe("Build");
    expect(t.blocks[1].weeks[0].name).toBeNull();
  });

  it("lists a week's workouts by date (undated last) with done counts that leave optional ones out", () => {
    const w4 = t.blocks[1].weeks[1];
    expect(w4.days.map((d) => d.key)).toEqual(["d3", "d5", "d4", "d6"]);
    expect(w4.done).toBe(1);
    expect(w4.planned).toBe(3);
    expect(t.blocks[0]).toMatchObject({ done: 1, planned: 2, title: "Volume", no: 1 });
    expect(t.done).toBe(2);
    expect(t.planned).toBe(5);
  });

  it("a finished program opens on its last block, with no week open", () => {
    const done = buildPlanTimeline(
      { currentBlockId: null, blocks: [block("x", "A", "completed", [week("a", 1, "completed")]), block("y", "B", "completed", [week("b", 1, "completed")])] },
      [],
    );
    expect(done.openBlockId).toBe("y");
    expect(done.openWeekId).toBeNull();
  });

  it("an empty program is an empty timeline", () => {
    expect(buildPlanTimeline({ currentBlockId: null, blocks: [] }, [])).toEqual({ blocks: [], openBlockId: null, openWeekId: null, done: 0, planned: 0 });
  });

  it("names", () => {
    expect(weekName({ label: "Week 3" })).toBeNull();
    expect(weekName({ label: "Deload" })).toBe("Deload");
    expect(blockTitleOf({ label: null, name: "Block 2: Strength" })).toBe("Strength");
    expect(blockTitleOf({ label: "Peak", name: "Block 3 — Whatever" })).toBe("Peak");
  });
});
