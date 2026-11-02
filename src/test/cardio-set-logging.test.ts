/**
 * Post-workout cardio (a treadmill walk) logs like a real cardio set: Time,
 * optional Calories and RPE, and it's marked done once anything goes in, at
 * its prescribed time unless a time was logged.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSetLogComplete, timedSetAutoDuration } from "@/lib/set-completion";
import { isTimedCardio } from "@/lib/timed-cardio";
import { SET_FIELDS, snapshotKey, snapshotOf } from "@/lib/card-history";

describe("timedSetAutoDuration", () => {
  const base = { showTimer: true, loggedSeconds: null, edited: true, prescribedSeconds: 600 };

  it("a timed set with RPE or calories in and no time logged is done at its prescribed time", () => {
    expect(timedSetAutoDuration(base)).toBe(600);
    expect(isSetLogComplete({ requireReps: false, requireTime: true, hideWeight: true, durationSeconds: timedSetAutoDuration(base) })).toBe(true);
  });

  it("a time logged with the timer or typed always wins", () => {
    expect(timedSetAutoDuration({ ...base, loggedSeconds: 510 })).toBeNull();
  });

  it("nothing is assumed before the person enters anything, or without a prescribed time", () => {
    expect(timedSetAutoDuration({ ...base, edited: false })).toBeNull();
    expect(timedSetAutoDuration({ ...base, prescribedSeconds: null })).toBeNull();
    expect(timedSetAutoDuration({ ...base, prescribedSeconds: 0 })).toBeNull();
    expect(timedSetAutoDuration({ ...base, showTimer: false })).toBeNull();
  });

  it("calories alone never make a set done without a time to go with it", () => {
    expect(isSetLogComplete({ requireReps: false, requireTime: true, hideWeight: true, durationSeconds: null })).toBe(false);
  });
});

describe("which exercises get the Calories box by default", () => {
  it("steady cardio done for time, never a carry, a plank or a lunge", () => {
    for (const n of ["Treadmill Walk", "Walking Fast", "Stationary Exercise Bike", "Elliptical", "Rowing Machine"]) expect(isTimedCardio(n)).toBe(true);
    for (const n of ["Dumbbell Suitcase Carry", "Plank", "Walking Lunges", "Dumbbell Farmer Walks"]) expect(isTimedCardio(n)).toBe(false);
  });
});

describe("the logger's cardio row", () => {
  const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

  it("shows Calories on cardio rows by default, optional, and in the columns menu for any row", () => {
    expect(view).toContain('const cardioRow = trackingType === "time" && isTimedCardio(name);');
    expect(view).toContain("const showCalories = inputOverrides.calories ?? cardioRow;");
    expect(view).toContain('["calories", "Calories", showCalories]');
    expect(view).toContain('placeholder="kcal"');
    expect(view).toContain("data-set-calories");
  });

  it("saves calories (only where the box shows) and the auto time with the set", () => {
    expect(view).toContain("...(showCalories ? { actual_calories: caloriesNum } : {}),");
    expect(view).toContain('completed_duration_seconds: autoDuration, completion_method: "prescribed_quick_confirm"');
    expect(view).toContain("durationSeconds: durationSec ?? autoDuration,");
    expect(view).toContain("durationSeconds: durationSec ?? autoDurationFor(rpeEdited || caloriesEdited),");
  });

  it("the database keeps calories whole and 0–5000, and undo restores them", () => {
    const sql = readFileSync("supabase/migrations/20270116090000_set_calories.sql", "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS actual_calories integer");
    expect(sql).toContain("actual_calories >= 0 AND actual_calories <= 5000");
    expect(SET_FIELDS).toContain("actual_calories");
    const a = snapshotOf([{ set_index: 1, actual_calories: 80 }], 1);
    const b = snapshotOf([{ set_index: 1, actual_calories: 95 }], 1);
    expect(a.sets[0].actual_calories).toBe(80);
    expect(snapshotKey(a)).not.toBe(snapshotKey(b));
  });
});

describe("the Time box says what's logged and what's only the target", () => {
  it("before it's logged the time reads as a target (dashed, muted); once logged it's green with a tick", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SetTimerInput } = await import("@/components/workout-day/set-timer-input");
    const box = (completedSeconds: number | null, isConfirmed: boolean) =>
      renderToStaticMarkup(
        React.createElement(SetTimerInput, {
          timerKey: `test:${completedSeconds}`,
          prescribedSeconds: 600,
          completedSeconds,
          isConfirmed,
          onCommit: () => {},
          ariaLabel: "Set 1 timer",
        }),
      );
    const target = box(null, false);
    expect(target).toContain("10:00");
    expect(target).toContain("border-dashed");
    expect(target).toContain("text-muted-foreground");
    expect(target).not.toContain("emerald");
    const logged = box(600, true);
    expect(logged).toContain("10:00");
    expect(logged).toContain("bg-emerald-500/10");
    expect(logged).not.toContain("border-dashed");
  });

  it("a row with no weight to log has no kg / lb switch", () => {
    const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(view).toContain("{!readonly && onUnitChange && !hideWeight && (");
  });
});
