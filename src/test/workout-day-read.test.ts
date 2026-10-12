import { describe, expect, it } from "vitest";
import { computeDayReads, type DayReadRow } from "@/lib/workout-day-read";
import { estimateFor, buildLoadModel } from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

const NOW = new Date("2026-10-12T18:00:00Z");
const log = (session: string, d: number, kg: number, rpe: number): PreviousLiftLog => ({
  id: `${session}-${kg}-${Math.random()}`, exerciseId: "sq", exerciseName: "Competition Squat", sessionKey: session,
  occurredAt: new Date(NOW.getTime() - d * 864e5).toISOString(), reps: 5, rpe, rir: null,
  enteredValue: kg, enteredUnit: "kg", normalizedKg: kg, normalizedLb: kg * 2.2046, isWorkingSet: true, loadType: "external",
});
const history = [log("a", 9, 140, 8), log("a", 9, 140, 8), log("b", 2, 145, 8), log("b", 2, 145, 8)];
const usual = estimateFor(buildLoadModel({ history, today: [], unit: "kg", now: NOW }), 5, 8)!.load;
const row = (rowId: string, exerciseKey: string, family: string | null, sets: DayReadRow["sets"] = []): DayReadRow =>
  ({ rowId, name: rowId, exerciseKey, family, history, sets });

describe("live across cards", () => {
  const top = row("top", "sq", "squat", [{ load: usual * 1.05, reps: 5, rpe: 8, at: 1 }]);

  it("the back-off of the same exercise takes 80% of how the top set ran", () => {
    const reads = computeDayReads([top, row("back", "sq", "squat"), row("pause", "psq", "squat"), row("curl", "curl", null)], null, NOW);
    expect(reads.get("top")!.own).toBeCloseTo(1.05, 6);
    expect(reads.get("back")!.factor).toBeCloseTo(1.04, 6);
    expect(reads.get("back")!.fromName).toBe("top");
    // a variation of the family: 50%
    expect(reads.get("pause")!.factor).toBeCloseTo(1.025, 6);
    // other lifts don't move
    expect(reads.get("curl")!.factor).toBeNull();
  });

  it("carries the same exercise's sets for a card with no history of its own", () => {
    const reads = computeDayReads([top, { ...row("back", "sq", "squat"), history: [] }], null, NOW);
    expect(reads.get("back")!.carryKg).toEqual([{ load: usual * 1.05, reps: 5, rpe: 8 }]);
  });

  it("the most recently logged card of the lift leads", () => {
    const later = row("back1", "sq", "squat", [{ load: usual * 0.95, reps: 5, rpe: 8, at: 5 }]);
    const reads = computeDayReads([top, later, row("back2", "sq", "squat")], null, NOW);
    expect(reads.get("back2")!.fromName).toBe("back1");
    expect(reads.get("back2")!.factor).toBeCloseTo(0.96, 6);
  });
});
