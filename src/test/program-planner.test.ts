import { describe, it, expect } from "vitest";
import { computePlacements } from "@/lib/program-planner/placement";
import { detectConflicts } from "@/lib/program-planner/conflicts";
import { computeCoverage } from "@/lib/program-planner/coverage";
import {
  exerciseKey, selectAll, summarize, materializeSelectedDays,
  iterateExercises, getNodeState, setNode,
} from "@/lib/program-planner/selection";
import { normalizeTemplatePayload } from "@/lib/pl-template-blocks";

function fakeTemplate() {
  return normalizeTemplatePayload({
    schema_version: 2,
    blocks: [
      {
        id: "B1", name: "Block 1",
        weeks: [
          { days: [
            { title: "Squat", exercises: [{ name: "Squat" }, { name: "Bench" }] },
            { title: "Pull",  exercises: [{ name: "Row" }] },
          ] },
          { days: [
            { title: "Deadlift", exercises: [{ name: "DL" }, { name: "GHR" }] },
          ] },
        ],
      },
    ],
  });
}

describe("selection", () => {
  it("selectAll picks every exercise and summary counts match", () => {
    const t = fakeTemplate();
    const sel = selectAll(t);
    const s = summarize(t, sel);
    expect(s).toEqual({ blocks: 1, weeks: 2, days: 3, exercises: 5 });
  });

  it("deselecting one exercise makes the day partial", () => {
    const t = fakeTemplate();
    let sel = selectAll(t);
    const target = exerciseKey("B1", 0, 0, 1);
    sel = setNode(t, sel, { blockKey: "B1", weekIndex: 0, dayIndex: 0, exerciseIndex: 1 }, false);
    expect(sel.exerciseKeys.includes(target)).toBe(false);
    expect(getNodeState(t, sel, { blockKey: "B1", weekIndex: 0, dayIndex: 0 })).toBe("partial");
    expect(getNodeState(t, sel, { blockKey: "B1" })).toBe("partial");
  });

  it("materializeSelectedDays preserves order and filters exercises", () => {
    const t = fakeTemplate();
    let sel = selectAll(t);
    sel = setNode(t, sel, { blockKey: "B1", weekIndex: 0, dayIndex: 0, exerciseIndex: 1 }, false);
    const days = materializeSelectedDays(t, sel);
    expect(days).toHaveLength(3);
    expect(days[0].day.exercises).toHaveLength(1);   // bench removed
    expect(days[1].day.exercises).toHaveLength(1);
    expect(days[2].day.exercises).toHaveLength(2);
  });
});

describe("placement", () => {
  it("entire_sequence places days on consecutive dates", () => {
    const t = fakeTemplate();
    const days = materializeSelectedDays(t, selectAll(t));
    const p = computePlacements({
      method: "entire_sequence", startDate: "2026-06-15", trainingDays: [], days,
    });
    expect(p.map((x) => x.date)).toEqual(["2026-06-15","2026-06-16","2026-06-17"]);
  });

  it("weekday_map distributes onto chosen weekdays", () => {
    const t = fakeTemplate();
    const days = materializeSelectedDays(t, selectAll(t));
    // 2026-06-15 = Monday. Place on Mon + Wed + Fri.
    const p = computePlacements({
      method: "weekday_map", startDate: "2026-06-15", trainingDays: ["mon","wed","fri"], days,
    });
    expect(p.map((x) => x.date)).toEqual(["2026-06-15","2026-06-17","2026-06-19"]);
  });

  it("fill_empty skips occupied dates", () => {
    const t = fakeTemplate();
    const days = materializeSelectedDays(t, selectAll(t));
    const p = computePlacements({
      method: "fill_empty", startDate: "2026-06-15",
      trainingDays: ["mon","tue","wed","thu","fri","sat","sun"],
      occupiedDates: new Set(["2026-06-16"]),
      days,
    });
    expect(p.map((x) => x.date)).toEqual(["2026-06-15","2026-06-17","2026-06-18"]);
  });
});

describe("conflicts", () => {
  it("flags completed protection and duplicate incoming", () => {
    const placements = [
      { dayKey: "d1", blockKey: "B1", weekIndex: 0, dayIndex: 0, title: "A", exerciseKeys: [], date: "2026-06-15" },
      { dayKey: "d2", blockKey: "B1", weekIndex: 0, dayIndex: 1, title: "B", exerciseKeys: [], date: "2026-06-15" },
    ];
    const c = detectConflicts({
      placements,
      existingDays: [{ dayId: "X", blockId: "BX", scheduled_date: "2026-06-15", completed: true }],
      existingBlocks: [],
    });
    const types = c.map((x) => x.type).sort();
    expect(types).toContain("completed_protected");
    expect(types).toContain("duplicate_incoming");
  });
});

describe("coverage", () => {
  it("derives programmedThrough and future weeks", () => {
    const cov = computeCoverage({
      existingDays: [
        { dayId: "1", blockId: "B", scheduled_date: "2026-07-01" },
        { dayId: "2", blockId: "B", scheduled_date: "2026-08-15" },
      ],
      today: "2026-06-15",
    });
    expect(cov.programmedThrough).toBe("2026-08-15");
    expect(cov.futureWeeks).toBe(Math.floor(61 / 7));
  });
});

// iterateExercises is exercised through selectAll, but keep an explicit smoke
// assertion so a regression in the iteration order surfaces immediately.
it("iterateExercises yields template-order exercise keys", () => {
  const t = fakeTemplate();
  const keys = Array.from(iterateExercises(t)).map((x) => x.exerciseKey);
  expect(keys).toEqual([
    "B1::w0::d0::e0", "B1::w0::d0::e1", "B1::w0::d1::e0",
    "B1::w1::d0::e0", "B1::w1::d0::e1",
  ]);
});