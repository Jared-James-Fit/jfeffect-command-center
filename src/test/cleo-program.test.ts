import { describe, expect, it } from "vitest";
import { rxText, rxToRow, trainingDayDates } from "@/lib/cleo-program";
import { CLEO_ACTION_PARAMS, actionPermission, routeFor } from "@/lib/cleo-actions";

const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

describe("prescriptions", () => {
  it("land on a row the way the program editor stores them", () => {
    expect(rxToRow({ sets: 4, reps: "6-8", rpe: "8", load: 100, load_unit: "kg" })).toEqual({
      sets: 4, reps_text: "6-8", rpe: "8", load_unit: "kg", load_kg: 100, load_lb: null, percentage: null, percentage_basis: "manual",
    });
    expect(rxToRow({ percentage: 75, percentage_of: "training_max" })).toMatchObject({ percentage: 75, percentage_basis: "training_max", load_kg: null, load_lb: null });
    expect(rxToRow({ rest_seconds: 150 })).toEqual({ rest_seconds: 150, rest_seconds_override: 150 });
    // An edit that only changes RPE leaves everything else alone.
    expect(rxToRow({ rpe: "7" })).toEqual({ rpe: "7" });
  });

  it("read like a program on the card", () => {
    expect(rxText({ sets: 4, reps: "6-8", rpe: "8", load: 225, load_unit: "lb", rest_seconds: 150 })).toBe("4 x 6-8 @RPE 8, 225 lb, rest 2:30");
    expect(rxText({ sets: 3, reps_text: "5", rir: "2", percentage: 80, percentage_basis: "1rm" })).toBe("3 x 5 @2 RIR, 80% 1rm");
    expect(rxText({})).toBe("");
  });
});

describe("dates for a new block", () => {
  it("puts each workout on the next training weekday in its week", () => {
    // 2026-10-12 is a Monday.
    expect(trainingDayDates("2026-10-12", 1, ["mon", "wed", "fri"])).toEqual(["2026-10-12", "2026-10-14", "2026-10-16"]);
    expect(trainingDayDates("2026-10-12", 2, ["mon", "wed", "fri"])).toEqual(["2026-10-19", "2026-10-21", "2026-10-23"]);
  });

  it("counts from the start day when the block starts mid-week", () => {
    // Starts Wednesday: Wed, Fri, then Mon of the following calendar week.
    expect(trainingDayDates("2026-10-14", 1, ["mon", "wed", "fri"])).toEqual(["2026-10-14", "2026-10-16", "2026-10-19"]);
  });
});

describe("program cards", () => {
  it("are the owner's call for the finance login", () => {
    const finance = { isAdmin: false, permissions: ["admin.view", "payments.record", "payments.request", "tasks.manage"] };
    for (const k of ["build_program", "edit_program_day", "add_workout", "assign_program_template", "publish_program", "move_workout", "correct_logged_exercise", "set_nutrition_targets"] as const) {
      expect(routeFor(actionPermission(k, {}), finance)).toBe("ask_owner");
    }
  });

  it("need a library exercise for adds and swaps, and a row for everything else", () => {
    const day = id(1);
    const ok = CLEO_ACTION_PARAMS.edit_program_day.safeParse({ day_id: day, changes: [{ op: "update", row_id: id(2), rpe: "8" }, { op: "add", exercise_id: id(3), sets: 3, reps: "10-12" }] });
    expect(ok.success).toBe(true);
    expect(CLEO_ACTION_PARAMS.edit_program_day.safeParse({ day_id: day, changes: [{ op: "add", sets: 3 }] }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.edit_program_day.safeParse({ day_id: day, changes: [{ op: "remove" }] }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.edit_program_day.safeParse({ day_id: day, changes: [{ op: "swap", row_id: id(2) }] }).success).toBe(false);
  });

  it("build a block with one weekday per day, defaulting to hidden", () => {
    const base = {
      client_id: id(1), name: "Strength 1", start_date: "2026-10-12", weeks: 4,
      days: [
        { title: "Squat", exercises: [{ exercise_id: id(2), sets: 4, reps: "4", rpe: "7", weeks: [{ week: 2, rpe: "8" }, { week: 4, sets: 2, rpe: "6" }] }] },
        { title: "Bench", exercises: [{ exercise_id: id(3), sets: 4, reps: "5", rpe: "7" }] },
      ],
    };
    expect(CLEO_ACTION_PARAMS.build_program.parse(base)).toMatchObject({ publish: false });
    expect(CLEO_ACTION_PARAMS.build_program.safeParse({ ...base, training_days: ["mon", "thu"] }).success).toBe(true);
    expect(CLEO_ACTION_PARAMS.build_program.safeParse({ ...base, training_days: ["mon"] }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.build_program.safeParse({ ...base, training_days: ["mon", "mon"] }).success).toBe(false);
  });
});

describe("fixing what was logged, and nutrition", () => {
  it("relabels a logged row by row and library exercise only", () => {
    expect(CLEO_ACTION_PARAMS.correct_logged_exercise.safeParse({ row_id: id(1), exercise_id: id(2) }).success).toBe(true);
    expect(CLEO_ACTION_PARAMS.correct_logged_exercise.safeParse({ row_id: id(1), exercise_name: "Barbell Bench" }).success).toBe(false);
  });

  it("sets every day type with sane macros", () => {
    const ok = { client_id: id(1), phase: "Fat Loss", days: [{ day_label: "Training Day", calories: 2200, protein: 180, carbs: 220, fats: 65 }, { day_label: "Rest Day", calories: 1900, protein: 180, carbs: 150, fats: 65 }] };
    expect(CLEO_ACTION_PARAMS.set_nutrition_targets.safeParse(ok).success).toBe(true);
    expect(CLEO_ACTION_PARAMS.set_nutrition_targets.safeParse({ ...ok, days: [] }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.set_nutrition_targets.safeParse({ ...ok, phase: "Shred" }).success).toBe(false);
    expect(CLEO_ACTION_PARAMS.set_nutrition_targets.safeParse({ ...ok, days: [{ day_label: "Every Day", calories: 300, protein: 100, carbs: 0, fats: 0 }] }).success).toBe(false);
  });
});

