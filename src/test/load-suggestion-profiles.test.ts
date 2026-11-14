import { describe, expect, it } from "vitest";
import { buildLoadModel, estimateFor, HISTORY_PROFILES, liftKindOf } from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

// How a lift's history is read (load-suggestion.ts header note 3), backtested
// Nov 14 2026 on 2,807 real first sets of a lift's day from history alone:
// competition lifts 8.98% → 7.66% median off, everything else 5.3% → 4.4%.
const NOW = new Date("2026-11-14T18:00:00Z");
const log = (session: string, d: number, kg: number, reps: number, rpe: number): PreviousLiftLog => ({
  id: `${session}-${kg}-${reps}-${Math.random()}`, exerciseId: "x", exerciseName: "x", sessionKey: session,
  occurredAt: new Date(NOW.getTime() - d * 86_400_000).toISOString(), reps, rpe, rir: null,
  enteredValue: kg, enteredUnit: "kg", normalizedKg: kg, normalizedLb: kg * 2.2046226218, isWorkingSet: true, loadType: "external",
});

describe("history profiles", () => {
  it("only the competition squat, bench and deadlift read as competition lifts", () => {
    expect(liftKindOf({ competition_lift_type: "deadlift", is_competition_lift: true })).toBe("competition");
    expect(liftKindOf({ competition_lift_type: null, is_competition_lift: true })).toBe("competition");
    expect(liftKindOf({ competition_lift_type: null, is_competition_lift: false })).toBe("other"); // a paused bench, a curl
    expect(liftKindOf(null)).toBe("other");
  });

  it("pins the measured settings", () => {
    expect(HISTORY_PROFILES.competition).toEqual({ alpha: 0.85, halfLifeDays: 3, repKernel: 0.5, rpeKernel: 0.5 });
    expect(HISTORY_PROFILES.other).toEqual({ alpha: 0.3, halfLifeDays: 2, repKernel: 1, rpeKernel: 1 });
    expect(buildLoadModel({ history: [], today: [], unit: "kg", now: NOW }).lift).toBe("other");
  });

  it("a competition lift follows the RPE chart to a heavier day; an accessory stays near the load used", () => {
    // Two weeks of 5s @ 7; today asks for a heavy triple @ 9.
    const history = [log("a", 9, 140, 5, 7), log("a", 9, 140, 5, 7), log("b", 2, 142.5, 5, 7), log("b", 2, 142.5, 5, 7)];
    const at = (lift: "competition" | "other") => estimateFor(buildLoadModel({ history, today: [], unit: "kg", now: NOW, lift }), 3, 9)!.load;
    // The chart says 5 @ 7 → 3 @ 9 is about +11%.
    expect(at("competition") / 142.5).toBeGreaterThan(1.08);
    expect(at("other") / 142.5).toBeLessThan(1.05);
  });

  it("an accessory leans on its last session more than a competition lift does", () => {
    // Last week 60 kg, the week before 50 kg, both 10 @ 8.
    const history = [log("old", 14, 50, 10, 8), log("old", 14, 50, 10, 8), log("new", 7, 60, 10, 8), log("new", 7, 60, 10, 8)];
    const at = (lift: "competition" | "other") => estimateFor(buildLoadModel({ history, today: [], unit: "kg", now: NOW, lift }), 10, 8)!.load;
    expect(at("other")).toBeGreaterThan(at("competition"));
    expect(at("other")).toBeGreaterThan(59);
  });
});
