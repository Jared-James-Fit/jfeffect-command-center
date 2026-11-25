import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analysableExercise } from "@/lib/lift-analysis/exercise";
import { formatSet, type LoggedSet } from "@/lib/cleo-data";

const SQL = readFileSync(
  resolve(__dirname, "../../../supabase/migrations/20270527101300_velocity_always_on_the_set.sql"),
  "utf8",
);

/** The server's `_velocity_analysable`, run in JS (Postgres \m \M are word boundaries). */
function serverAnalysable(name: string): boolean {
  const fn = SQL.slice(SQL.indexOf("FUNCTION public._velocity_analysable"), SQL.indexOf("$$;", SQL.indexOf("FUNCTION public._velocity_analysable")));
  const res = [...fn.matchAll(/~ '([^']+)'/g)].map((m) => new RegExp(m[1].replace(/\\m|\\M/g, "\\b"), "i"));
  const [notABar, machine, smith, include] = res;
  const s = name.toLowerCase();
  if (!s.trim() || notABar.test(s)) return false;
  if (machine.test(s) && !smith.test(s)) return false;
  return include.test(s);
}

describe("which set videos are read by themselves", () => {
  const names = [
    "Competition Squat", "High Bar Squat", "Paused Bench Press", "Larsen Press", "Competition Deadlift",
    "Sumo Deadlift", "Romanian Deadlift", "Stiff-Leg Deadlift", "Good Morning", "Barbell Row", "Pendlay Row",
    "Overhead Press", "Push Press", "Power Snatch", "Hang Clean", "Clean and Jerk", "Split Jerk", "Snatch High Pull",
    "Barbell Hip Thrust", "Smith Machine Squat",
    "Dumbbell Bench Press", "Cable Row", "Leg Press", "Hack Squat", "Pull-up", "Landmine Row", "Chest Press Machine",
    "Lat Pulldown", "Treadmill Walk", "Stretch",
  ];
  it("the server and the phone agree on every name", () => {
    for (const n of names) expect([n, serverAnalysable(n)]).toEqual([n, analysableExercise(n)]);
  });
  it("Olympic lifts, presses, rows and RDL variants are read; dumbbells, cables and machines aren't", () => {
    for (const n of ["Power Snatch", "Split Jerk", "Push Press", "Pendlay Row", "Stiff-Leg Deadlift"]) expect(serverAnalysable(n)).toBe(true);
    for (const n of ["Dumbbell Bench Press", "Cable Row", "Chest Press Machine", "Landmine Row"]) expect(serverAnalysable(n)).toBe(false);
  });
  it("the server's writeback no longer demands a confirmed plate or an exact rep count", () => {
    const apply = SQL.slice(SQL.indexOf("FUNCTION public._apply_video_velocity"));
    expect(apply).toContain("actual_load_kg, 0) >= 59.5");
    expect(apply).toContain("plateCheck");
    expect(apply).toContain("abs(r.actual_reps - nr) > 1");
  });
});

describe("Cleo sees bar speed", () => {
  const set: LoggedSet = {
    completed_at: "2026-11-24T18:00:00Z", exercise: "Competition Squat", day_title: null, set_index: 3,
    entered_value: 140, entered_unit: "kg", normalized_kg: 140, normalized_lb: null, reps: 4, rpe: 8, rir: null,
    is_working_set: true, load_type: null, is_bodyweight: false, notes: null,
  };
  it("a measured speed, an estimate with ≈, and nothing without one", () => {
    expect(formatSet({ ...set, velocity_mps: 0.4227 }, "kg")).toBe("140 kg x 4 @RPE 8 | 0.42 m/s");
    expect(formatSet({ ...set, velocity_mps: 0.4227, velocity_quality: "estimated" }, "kg")).toContain("| ≈0.42 m/s");
    expect(formatSet(set, "kg")).not.toContain("m/s");
  });
});
