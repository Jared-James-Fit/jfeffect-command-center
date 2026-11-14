import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  distanceInputValue, formatDistance, formatPace, isRunningExercise, paceSeconds, parseDistanceInput,
  recoveryWord, runPrescription, runSummaryLine, runTotals,
} from "@/lib/running/run-log";
import { parseDurationInput } from "@/lib/duration";
import { fmtMMSS, parseMMSS } from "@/lib/set-timer-store";
import { estimateDayMinutes, estimateRowSeconds } from "@/lib/pl-programs";
import { formatPreviousTimed, summarizeTimedSession } from "@/lib/workout-previous-lift";
import { cardioDraftIssue, cardioEditDraft, cardioEditPatch } from "@/lib/history-set-edit";
import { cardioHistorySummary } from "@/lib/cardio-history";
import { setGridTemplate } from "@/components/workout-day/set-grid";

describe("which exercises are runs", () => {
  it("runs and jogs, never walks, bikes or a lunge", () => {
    for (const n of ["Running", "Treadmill Running", "Jogging", "Easy Run"]) expect(isRunningExercise(n)).toBe(true);
    for (const n of ["Walking", "Treadmill Walk", "Bike", "Walking Lunges", "Running Lunge"]) expect(isRunningExercise(n)).toBe(false);
  });
});

describe("distance in and out", () => {
  it("reads km or miles, with a comma or a point, into metres", () => {
    expect(parseDistanceInput("5.2", "km")).toBe(5200);
    expect(parseDistanceInput("5,2", "km")).toBe(5200);
    expect(parseDistanceInput("13.1", "mi")).toBeCloseTo(21082, 0);
    expect(parseDistanceInput("", "km")).toBeNull();
    expect(parseDistanceInput("0", "km")).toBeNull();
    expect(parseDistanceInput("301", "km")).toBeNull(); // more than one set can hold
    expect(parseDistanceInput("abc", "km")).toBeNull();
  });
  it("shows it back in the unit asked for", () => {
    expect(distanceInputValue(5200, "km")).toBe("5.2");
    expect(distanceInputValue(5200, "mi")).toBe("3.23");
    expect(formatDistance(42195, "km")).toBe("42.2 km");
    expect(formatDistance(850, "km")).toBe("850 m");
    expect(formatDistance(21097.5, "mi")).toBe("13.1 mi");
    expect(formatDistance(null, "km")).toBe("");
  });
});

describe("pace", () => {
  it("is time over distance, per km or mile", () => {
    expect(formatPace(paceSeconds(1780, 5200, "km"), "km")).toBe("5:42 /km");
    expect(formatPace(paceSeconds(3600, 10000, "km"), "km")).toBe("6:00 /km");
    expect(paceSeconds(1780, null, "km")).toBeNull();
  });
  it("a run's line adds up its sets and paces only the ones with both", () => {
    const sets = [{ durationSeconds: 900, distanceM: 2500 }, { durationSeconds: 900, distanceM: 2700 }, { durationSeconds: 300, distanceM: null }];
    expect(runTotals(sets)).toMatchObject({ seconds: 2100, meters: 5200, pacedSeconds: 1800, pacedMeters: 5200 });
    expect(runSummaryLine(sets, "km")).toBe("5.2 km · 35:00 · 5:46 /km");
    expect(runSummaryLine([{ durationSeconds: 900, distanceM: null }], "km")).toBeNull();
  });
});

describe("a run's prescription reads like a run", () => {
  it("continuous, intervals with their recovery, run/walk and a race", () => {
    expect(runPrescription({ sets: 1, durationSeconds: 2400, restSeconds: 0, rpe: "3-4" })).toBe("40 min | RPE 3–4");
    expect(runPrescription({ sets: 3, durationSeconds: 480, restSeconds: 120, role: "Threshold", rpe: "6-7" })).toBe("3 × 8 min · 2 min easy jog between | RPE 6–7");
    expect(runPrescription({ sets: 8, durationSeconds: 60, restSeconds: 90, role: "Run/walk", rpe: "3-4" })).toBe("8 × 1 min · 1:30 walk between | RPE 3–4");
    expect(runPrescription({ sets: 1, durationSeconds: 10200, restSeconds: 0, rpe: "3-4" })).toBe("2 h 50 min | RPE 3–4");
    expect(runPrescription({ sets: 1, durationSeconds: null, restSeconds: 0, repsText: "5 km", rpe: "4-6" })).toBe("5 km | RPE 4–6");
    expect(recoveryWord("Strides")).toBe("walk");
  });
});

describe("long runs take hours", () => {
  it("typed as h:mm:ss in the time box and the timer", () => {
    expect(parseDurationInput("1:45:30")).toBe(6330);
    expect(parseDurationInput("18:30")).toBe(1110);
    expect(parseMMSS("1:45:30")).toBe(6330);
    expect(parseMMSS("1:30")).toBe(90);
    expect(fmtMMSS(6330)).toBe("1:45:30");
    expect(fmtMMSS(90)).toBe("1:30");
  });
  it("the day's estimate counts a timed row's own time, and a run day has no general warm-up on top", () => {
    expect(estimateRowSeconds({ sets: 1, measurement_type: "time", duration_seconds: 5400, rest_seconds: 0 })).toBe(5400);
    expect(estimateRowSeconds({ sets: 3, measurement_type: "time", duration_seconds: 480, rest_seconds: 120 })).toBe(3 * 480 + 2 * 120);
    const longRunDay = [{ sets: 1, measurement_type: "time", duration_seconds: 5400, rest_seconds: 0 }];
    expect(estimateDayMinutes(longRunDay)).toBe(90);
    // a lifting row is estimated as before
    expect(estimateRowSeconds({ sets: 3, rest_seconds: 120, time_profile: "accessory_isolation" })).toBeGreaterThan(3 * 120);
  });
});

describe("last time and history for a run", () => {
  it("last time adds the session's distance (a walk reads as before)", () => {
    const t = summarizeTimedSession("cardio", [{ durationSeconds: 1930, distanceM: 5400, rpe: 4 } as any]);
    expect(t.meters).toBe(5400);
    expect(formatPreviousTimed(t, (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, (m) => formatDistance(m, "km"))).toBe("32:10 · 5.4 km · RPE 4");
    expect(summarizeTimedSession("cardio", [{ durationSeconds: 600, calories: 80 } as any])).not.toHaveProperty("meters");
  });
  it("the history summary averages distance per session", () => {
    const s = cardioHistorySummary([
      { date: "2026-11-01", sets: [{ completed_duration_seconds: 1800, actual_distance_m: 5000 }] },
      { date: "2026-11-03", sets: [{ completed_duration_seconds: 2400, actual_distance_m: 7000 }] },
    ]);
    expect(s.avgMeters).toBe(6000);
  });
  it("a past run's distance is fixed in its own unit, and only a real change is written", () => {
    const set = { id: "a", completed_duration_seconds: 1800, actual_distance_m: 8046.72, actual_distance_unit: "mi" };
    const d = cardioEditDraft(set, "km");
    expect(d).toMatchObject({ distance: "5", distanceUnit: "mi" });
    expect(cardioEditPatch(set, d)).toBeNull();
    expect(cardioEditPatch(set, { ...d, distance: "5.5" })).toMatchObject({ actual_distance_m: 8851.4, actual_distance_unit: "mi" });
    expect(cardioDraftIssue({ ...d, distance: "999" })).toMatch(/Distance/);
  });
});

describe("the workout card (source)", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("a run logs distance by default, km first, and shows its pace", () => {
    expect(wdv).toContain("const showDistance = inputOverrides.distance ?? runRow;");
    expect(wdv).toContain("const showCalories = inputOverrides.calories ?? (cardioRow && !runRow);");
    expect(wdv).toContain("data-set-distance");
    expect(wdv).toContain("data-run-summary");
    expect(wdv).toContain("data-run-rx");
    expect(setGridTemplate({ showReps: false, showTimer: true, showDistance: true, showCalories: false, showVelocity: false, hideWeight: true, videoColumn: false })).toBe("34px 1fr 1fr 1fr");
  });
});

describe("Edit with AI can change a run's time", () => {
  it("reads seconds or a clock, under any of the names a model uses", async () => {
    const { rxPatchSchema } = await import("@/lib/program-ai/ops");
    expect(rxPatchSchema.parse({ duration: "30:00" })).toEqual({ duration_seconds: 1800 });
    expect(rxPatchSchema.parse({ duration_seconds: 5400 })).toEqual({ duration_seconds: 5400 });
    expect(rxPatchSchema.parse({ time: "1:45:00" })).toEqual({ duration_seconds: 6300 });
    expect(() => rxPatchSchema.parse({ duration_seconds: 99999 })).toThrow();
  });
});
