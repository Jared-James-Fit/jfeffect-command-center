import { describe, it, expect } from "vitest";
import {
  deriveSchedule,
  currentBlock,
  upcomingBlocks,
  historyBlocks,
  findOverlaps,
  gapDays,
  suggestedNextStart,
  instancesAffectedByEarlyEnd,
  completedPastNewEnd,
  impliedEnd,
  isEndedEarly,
  weekOf,
  durationLabel,
} from "@/lib/block-schedule-model";

const TODAY = "2026-09-14";

// Real shape of Nicole Yusi's blocks — the reported contradiction.
const nicole = [
  { id: "b1", name: "Block 1", status: "Active", start_date: "2026-07-20", end_date: "2026-08-16", weeks: 4, sort_order: 0 },
  { id: "b2", name: "Block 2", status: "Active", start_date: "2026-08-17", end_date: "2026-09-13", weeks: 4, sort_order: 1 },
  { id: "b3", name: "Block 3", status: "Completed", completed_at: "2026-09-11T19:25:34Z", start_date: "2026-09-14", end_date: "2026-10-11", weeks: 4, sort_order: 2 },
];

describe("canonical block schedule model", () => {
  it("never reports a past block as Active (root cause)", () => {
    const list = deriveSchedule(nicole, TODAY);
    expect(list.find((b) => b.id === "b1")!.status_derived).toBe("Completed");
    expect(list.find((b) => b.id === "b2")!.status_derived).toBe("Completed");
  });

  it("identifies exactly one current block from dates", () => {
    const list = deriveSchedule(
      [
        { id: "a", status: "Active", start_date: "2026-08-01", end_date: "2026-08-28", weeks: 4 },
        { id: "b", status: "Active", start_date: "2026-09-01", end_date: "2026-09-28", weeks: 4 },
      ],
      TODAY,
    );
    expect(list.filter((b) => b.status_derived === "Active")).toHaveLength(1);
    expect(currentBlock(list)!.id).toBe("b");
  });

  it("exposes start and end dates on the active block", () => {
    const list = deriveSchedule([{ id: "a", start_date: "2026-09-01", end_date: "2026-09-28", weeks: 4 }], TODAY);
    const cur = currentBlock(list)!;
    expect(cur.start_date).toBe("2026-09-01");
    expect(cur.effective_end).toBe("2026-09-28");
    expect(cur.week_of).toBe(2);
    expect(durationLabel(cur)).toBe("4 weeks");
  });

  it("surfaces upcoming blocks", () => {
    const list = deriveSchedule(
      [
        { id: "a", start_date: "2026-09-01", end_date: "2026-09-28", weeks: 4 },
        { id: "b", start_date: "2026-09-29", end_date: "2026-10-26", weeks: 4 },
      ],
      TODAY,
    );
    expect(upcomingBlocks(list).map((b) => b.id)).toEqual(["b"]);
  });

  it("puts finished blocks in history only, never Active", () => {
    const list = deriveSchedule(nicole, TODAY);
    const hist = historyBlocks(list);
    expect(hist.map((b) => b.id).sort()).toEqual(["b1", "b2", "b3"]);
    expect(hist.every((b) => b.status_derived !== "Active")).toBe(true);
  });

  it("detects an early end and keeps the original end as audit", () => {
    const b = { id: "a", start_date: "2026-09-01", end_date: "2026-09-18", weeks: 4 };
    expect(impliedEnd(b)).toBe("2026-09-28");
    expect(isEndedEarly(b)).toBe(true);
    const list = deriveSchedule([{ ...b, status: "Completed" }], TODAY);
    expect(list[0].status_derived).toBe("EndedEarly");
    expect(list[0].original_end).toBe("2026-09-28");
    expect(list[0].effective_end).toBe("2026-09-18");
  });

  it("allows an arbitrary mid-week end date", () => {
    const b = { id: "a", start_date: "2026-09-01", end_date: "2026-09-16", weeks: 4 };
    expect(isEndedEarly(b)).toBe(true);
    expect(weekOf(b, "2026-09-16")).toBe(3);
  });

  it("only unschedules future uncompleted workouts", () => {
    const instances = [
      { id: "1", scheduled_date: "2026-09-14", completed: true },
      { id: "2", scheduled_date: "2026-09-15", completed: false },
      { id: "3", scheduled_date: "2026-09-18", completed: false },
      { id: "4", scheduled_date: "2026-09-19", completed: false },
      { id: "5", scheduled_date: "2026-09-24", completed: true },
    ];
    const affected = instancesAffectedByEarlyEnd(instances, "2026-09-18");
    expect(affected.map((i) => i.id)).toEqual(["4"]);
    expect(completedPastNewEnd(instances, "2026-09-18").map((i) => i.id)).toEqual(["5"]);
  });

  it("mid-week ending keeps Mon/Tue and drops Thu/Sat", () => {
    const week = [
      { id: "mon", scheduled_date: "2026-09-14", completed: true },
      { id: "tue", scheduled_date: "2026-09-15", completed: true },
      { id: "thu", scheduled_date: "2026-09-17", completed: false },
      { id: "sat", scheduled_date: "2026-09-19", completed: false },
    ];
    expect(instancesAffectedByEarlyEnd(week, "2026-09-16").map((i) => i.id)).toEqual(["thu", "sat"]);
  });

  it("suggests the day after the current block ends", () => {
    const list = deriveSchedule([{ id: "a", start_date: "2026-09-01", end_date: "2026-09-18", weeks: 4 }], TODAY);
    expect(suggestedNextStart(list[0], TODAY)).toBe("2026-09-19");
  });

  it("allows a gap and reports it", () => {
    expect(gapDays("2026-09-18", "2026-09-23")).toBe(4);
    expect(gapDays("2026-09-18", "2026-09-19")).toBe(0);
  });

  it("detects overlapping live blocks", () => {
    const list = deriveSchedule(
      [
        { id: "a", start_date: "2026-09-10", end_date: "2026-09-20", weeks: 2 },
        { id: "b", start_date: "2026-09-18", end_date: "2026-10-15", weeks: 4 },
      ],
      TODAY,
    );
    const over = findOverlaps(list);
    expect(over).toHaveLength(1);
    expect([over[0].a.id, over[0].b.id].sort()).toEqual(["a", "b"]);
  });

  it("reports no overlap for back-to-back blocks", () => {
    const list = deriveSchedule(
      [
        { id: "a", start_date: "2026-09-01", end_date: "2026-09-18", weeks: 4 },
        { id: "b", start_date: "2026-09-19", end_date: "2026-10-16", weeks: 4 },
      ],
      TODAY,
    );
    expect(findOverlaps(list)).toHaveLength(0);
  });

  it("treats a dateless block as Draft, not Active", () => {
    const list = deriveSchedule([{ id: "a", status: "Active", weeks: 4 }], TODAY);
    expect(list[0].status_derived).toBe("Draft");
    expect(currentBlock(list)).toBeNull();
  });

  it("archived always wins", () => {
    const list = deriveSchedule([{ id: "a", archived: true, status: "Active", start_date: "2026-09-01", end_date: "2026-09-28", weeks: 4 }], TODAY);
    expect(list[0].status_derived).toBe("Archived");
  });
});
