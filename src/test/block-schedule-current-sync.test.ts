/**
 * CURRENT BLOCK SYNC — the Nicole Yusi contradiction.
 *
 * Production case: the coach reordered the client's program after her meet, so
 * "Block 2 — Strength / Intensification" carries a declared end_date of
 * 2026-09-13 while its actual scheduled workouts run 2026-09-14 → 2026-10-09,
 * and "Block 3 — Peak / Taper" is flagged Completed with all its workouts
 * finished on 2026-09-11. Date/status-only derivation reported "no block is
 * running today" even though the client's calendar was mid-block.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  deriveSchedule, buildEvidence, currentBlock, historyBlocks, upcomingBlocks,
  currentAssignmentId, blocksInAssignment, scheduleSaysRunning, coveredSpan,
} from "@/lib/block-schedule-model";

const TODAY = "2026-09-15";
const PREP_NOW = "prep-current";
const PREP_OLD = "prep-old";

const nicoleBlocks = [
  { id: "b1", prep_id: PREP_NOW, name: "Block 1 — Strength Base", status: "Active", start_date: "2026-07-20", end_date: "2026-08-16", weeks: 4, sort_order: 0 },
  { id: "b2", prep_id: PREP_NOW, name: "Block 2 — Intensification", status: "Active", start_date: "2026-08-17", end_date: "2026-09-13", weeks: 4, sort_order: 1 },
  { id: "b3", prep_id: PREP_NOW, name: "Block 3 — Peak / Taper", status: "Completed", completed_at: "2026-09-11T19:25:34Z", start_date: "2026-09-14", end_date: "2026-10-11", weeks: 4, sort_order: 2 },
];

const nicoleWorkouts = [
  { blockId: "b1", date: "2026-07-20", completed: true },
  { blockId: "b1", date: "2026-08-14", completed: true },
  { blockId: "b3", date: "2026-09-07", completed: true },
  { blockId: "b3", date: "2026-09-11", completed: true },
  { blockId: "b2", date: "2026-09-14", completed: true },
  { blockId: "b2", date: "2026-09-17", completed: false },
  { blockId: "b2", date: "2026-10-09", completed: false },
];

function derived(today = TODAY) {
  return deriveSchedule(nicoleBlocks, today, buildEvidence(nicoleWorkouts, today));
}

describe("current block comes from the real assigned schedule", () => {
  it("resolves the block the client is actually training as current", () => {
    const cur = currentBlock(derived());
    expect(cur?.id).toBe("b2");
    expect(cur?.status_derived).toBe("Active");
  });

  it("never reports an empty current block while outstanding workouts exist", () => {
    expect(currentBlock(derived())).not.toBeNull();
  });

  it("keeps the block current on a rest day (no workout scheduled today)", () => {
    // 2026-09-16 has no workout at all; b2 must stay Active.
    const cur = currentBlock(derived("2026-09-16"));
    expect(cur?.id).toBe("b2");
  });

  it("stretches the block window to cover its real scheduled workouts", () => {
    const cur = currentBlock(derived())!;
    expect(coveredSpan(cur, buildEvidence(nicoleWorkouts, TODAY).get("b2")).end).toBe("2026-10-09");
    expect(cur.effective_end).toBe("2026-10-09");
  });

  it("leaves a finished block finished when its calendar is fully completed", () => {
    const list = derived();
    expect(list.find((b) => b.id === "b3")!.status_derived).toBe("Completed");
    expect(list.find((b) => b.id === "b1")!.status_derived).toBe("Completed");
  });

  it("produces exactly one Active block", () => {
    expect(derived().filter((b) => b.status_derived === "Active")).toHaveLength(1);
  });

  it("puts finished blocks in history and never badges them Active", () => {
    const hist = historyBlocks(derived());
    expect(hist.map((b) => b.id).sort()).toEqual(["b1", "b3"]);
    expect(hist.every((b) => b.status_derived !== "Active")).toBe(true);
  });

  it("empty state only when there is truly no current assignment or block", () => {
    const none = deriveSchedule(
      [{ id: "x", prep_id: PREP_OLD, status: "Completed", start_date: "2026-01-01", end_date: "2026-02-01", weeks: 4 }],
      TODAY,
      buildEvidence([{ blockId: "x", date: "2026-01-05", completed: true }], TODAY),
    );
    expect(currentBlock(none)).toBeNull();
    expect(currentAssignmentId(none)).toBeNull();
  });
});

describe("assignment scoping", () => {
  const twoAssignments = [
    ...nicoleBlocks,
    { id: "old1", prep_id: PREP_OLD, name: "Block 2 — Intensification", status: "Active", start_date: "2026-03-01", end_date: "2026-12-31", weeks: 40, sort_order: 0 },
  ];

  it("the current assignment wins over an older assignment", () => {
    const list = deriveSchedule(twoAssignments, TODAY, buildEvidence(nicoleWorkouts, TODAY));
    expect(currentBlock(list)!.id).toBe("b2");
    expect(list.find((b) => b.id === "old1")!.status_derived).not.toBe("Active");
    expect(currentAssignmentId(list)).toBe(PREP_NOW);
  });

  it("does not flatten separate assignments into one sequence", () => {
    const list = deriveSchedule(twoAssignments, TODAY, buildEvidence(nicoleWorkouts, TODAY));
    expect(blocksInAssignment(list, PREP_NOW).map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(blocksInAssignment(list, PREP_OLD).map((b) => b.id)).toEqual(["old1"]);
  });

  it("duplicate block names across assignments do not collide", () => {
    const list = deriveSchedule(twoAssignments, TODAY, buildEvidence(nicoleWorkouts, TODAY));
    const sameName = list.filter((b) => b.name === "Block 2 — Intensification");
    expect(sameName).toHaveLength(2);
    expect(new Set(sameName.map((b) => b.id)).size).toBe(2);
    expect(sameName.filter((b) => b.status_derived === "Active")).toHaveLength(1);
  });
});

describe("scheduled workouts map to their own block", () => {
  it("treats a block with no remaining work as not running", () => {
    const ev = buildEvidence(nicoleWorkouts, TODAY);
    expect(scheduleSaysRunning(nicoleBlocks[2], TODAY, ev.get("b3"))).toBe(false);
    expect(scheduleSaysRunning(nicoleBlocks[1], TODAY, ev.get("b2"))).toBe(true);
  });

  it("keys evidence strictly by block id", () => {
    const ev = buildEvidence(nicoleWorkouts, TODAY);
    expect(ev.get("b2")!.total).toBe(3);
    expect(ev.get("b2")!.nextIncomplete).toBe("2026-09-17");
    expect(ev.get("b3")!.remaining).toBe(0);
  });

  it("upcoming blocks are blocks that have not started on any source", () => {
    const later = deriveSchedule(
      [{ id: "n", prep_id: PREP_NOW, start_date: "2026-10-12", end_date: "2026-11-08", weeks: 4 }],
      TODAY,
      new Map(),
    );
    expect(upcomingBlocks(later).map((b) => b.id)).toEqual(["n"]);
  });
});

describe("page and client calendar share one source", () => {
  const hook = fs.readFileSync("src/lib/use-client-training-schedule.ts", "utf8");

  it("derives status from the calendar rows the Client POV uses", () => {
    expect(hook).toMatch(/pl_scheduled_workouts/);
    expect(hook).toMatch(/pl_day_completions/);
    expect(hook).toMatch(/buildEvidence\(workouts, today\)/);
    expect(hook).toMatch(/deriveSchedule\(blockList, today, evidence\)/);
  });

  it("next workout is the next incomplete instance of the current block", () => {
    expect(hook).toMatch(/nextWorkout/);
    expect(hook).toMatch(/w\.blockId === current\.id/);
  });

  it("never writes to completion or schedule tables", () => {
    expect(hook).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.upsert\(/);
  });
});
