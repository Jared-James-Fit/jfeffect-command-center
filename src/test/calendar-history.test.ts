import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterCalendarItemsWithHistory,
  filterActiveCalendarItems,
  historicalAnchorDate,
  isAnchoredHistoricalItem,
} from "@/lib/active-calendar";

const today = "2026-08-27";

const programA = { id: "A1", sort_order: 1, status: "Completed", start_date: "2026-06-15", end_date: "2026-07-05" };
const programAArchived = { id: "A2", sort_order: 2, status: "Archived", start_date: "2026-07-06", end_date: "2026-07-26" };
const programB = { id: "B5", sort_order: 5, status: "Active", start_date: "2026-08-11", end_date: "2026-09-06" };
const programBNext = { id: "B6", sort_order: 6, status: "Draft", start_date: "2026-09-07", end_date: "2026-09-20" };

const item = (block: any, dayId: string, extra: any = {}) => ({
  block,
  week: { id: `${block.id}-w1`, week_index: 1, training_days: null },
  day: { id: dayId, day_index: 1, scheduled_date: null },
  completion: null,
  ...extra,
});

const completedInstance = (block: any, dayId: string, date: string) =>
  item(block, dayId, {
    scheduledWorkoutId: `i-${dayId}`,
    scheduledDate: date,
    completion: { id: `c-${dayId}`, completed_at: `${date}T18:00:00Z` },
  });

describe("calendar history contract", () => {
  it("1. completed Program A workouts remain visible after Program B becomes active", () => {
    const items = [completedInstance(programA, "a1", "2026-06-15"), item(programB, "b1", { scheduledDate: "2026-08-13" })];
    const kept = filterCalendarItemsWithHistory(items, today);
    expect(kept.map((i) => i.block.id).sort()).toEqual(["A1", "B5"]);
  });

  it("2. current-program filter does not hide historical completed workouts", () => {
    const old = completedInstance(programA, "a1", "2026-06-15");
    expect(filterActiveCalendarItems([old], today)).toHaveLength(0);
    expect(filterCalendarItemsWithHistory([old], today)).toHaveLength(1);
  });

  it("3+4. old completed block stays on its real date for month and week grids", () => {
    const old = completedInstance(programA, "a1", "2026-06-17");
    expect(historicalAnchorDate(old)).toBe("2026-06-17");
  });

  it("5+6. historical items keep their own program/block/week metadata", () => {
    const items = [completedInstance(programA, "a1", "2026-06-15"), item(programB, "b1", { scheduledDate: "2026-08-13" })];
    const kept = filterCalendarItemsWithHistory(items, today);
    const oldItem = kept.find((i) => i.day.id === "a1")!;
    expect(oldItem.block.id).toBe("A1");
    expect(oldItem.block.id).not.toBe(programB.id);
    expect(oldItem.week.id).toBe("A1-w1");
  });

  it("7. archived/ended program history remains visible", () => {
    const archived = completedInstance(programAArchived, "a2", "2026-07-10");
    expect(filterCalendarItemsWithHistory([archived], today)).toHaveLength(1);
  });

  it("8. a logged historical workout is never treated as an empty day", () => {
    const logged = item(programA, "a3", {
      logged_sets_count: 12,
      completion: { id: "c3", completed_at: "2026-06-20T17:00:00Z" },
    });
    expect(isAnchoredHistoricalItem(logged)).toBe(true);
    expect(historicalAnchorDate(logged)).toBe("2026-06-20");
  });

  it("9. a rescheduled completed workout appears exactly once, on the instance date", () => {
    const moved = item(programA, "a4", {
      day: { id: "a4", day_index: 2, scheduled_date: "2026-06-22" },
      scheduledWorkoutId: "i-a4",
      scheduledDate: "2026-06-24",
      completion: { id: "c4", completed_at: "2026-06-24T18:00:00Z" },
    });
    const kept = filterCalendarItemsWithHistory([moved], today);
    expect(kept).toHaveLength(1);
    expect(historicalAnchorDate(kept[0])).toBe("2026-06-24");
  });

  it("10. the legacy/original date on the day row is left untouched", () => {
    const moved = item(programA, "a4", {
      day: { id: "a4", day_index: 2, scheduled_date: "2026-06-22" },
      scheduledDate: "2026-06-24",
    });
    filterCalendarItemsWithHistory([moved], today);
    expect(moved.day.scheduled_date).toBe("2026-06-22");
  });

  it("11. future workouts still come from the current canonical schedule", () => {
    const kept = filterCalendarItemsWithHistory([item(programBNext, "b6")], today);
    expect(kept.map((i) => i.block.id)).toEqual(["B6"]);
  });

  it("12+13. one shared contract feeds every calendar surface, cadence never rebuilds history", () => {
    const src = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
    // Client portal and admin POV both render WorkoutsExperience → same byDate map.
    expect(src).toContain("filterCalendarItemsWithHistory(dayItems)");
    expect(src).toContain("const anchor = historicalAnchorDate(it);");
    // Historical items must not fall through to committed-cadence derivation.
    expect(src).toContain("if (!anchor) continue;");
  });

  it("14+15. filtering is pure — it never mutates instances, completions or logs", () => {
    const original = completedInstance(programA, "a1", "2026-06-15");
    const snapshot = JSON.parse(JSON.stringify(original));
    filterCalendarItemsWithHistory([original, item(programB, "b1", { scheduledDate: "2026-08-13" })], today);
    expect(original).toEqual(snapshot);
  });

  it("an unanchored stale day from a finished block is still not re-derived onto today's cadence", () => {
    const ghost = item(programA, "ghost");
    expect(filterCalendarItemsWithHistory([ghost], today)).toHaveLength(0);
  });
});
