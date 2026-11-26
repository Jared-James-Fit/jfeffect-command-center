import { describe, it, expect } from "vitest";
import {
  cleanCoachTitle,
  focusTitle,
  isGenericTitle,
  itemDisplayTitle,
  titleExerciseFromRow,
  workoutDisplayTitle,
  type TitleExercise,
} from "@/lib/workouts/workout-title";

const ex = (name: string, extra: Partial<TitleExercise> = {}): TitleExercise => ({ name, sets: 3, ...extra });

describe("workout display titles", () => {
  it("keeps a meaningful coach name, cleaned of RPE, role and phase", () => {
    expect(workoutDisplayTitle({ title: "Mock Meet", dayIndex: 4 })).toBe("Mock Meet");
    expect(workoutDisplayTitle({ title: "Heavy Singles (RPE 8)" })).toBe("Heavy Singles");
    expect(workoutDisplayTitle({ title: "Upper Body — Hypertrophy Phase" })).toBe("Upper Body");
    expect(workoutDisplayTitle({ title: "Squat & Bench | Primary" })).toBe("Squat & Bench");
    expect(workoutDisplayTitle({ title: "Day 1 — Monday, June 16 — Lower Body" })).toBe("Lower Body");
    expect(cleanCoachTitle("Week 3 Day 2: Pull @8")).toBe("Pull");
    expect(workoutDisplayTitle({ title: "Monday — Upper Body" })).toBe("Upper Body");
  });

  it("generic names are read from the exercises", () => {
    for (const t of ["Day 1", "Workout A", "Session 3", "Monday", "Training Day 2", "W3D2", ""]) {
      expect(isGenericTitle(cleanCoachTitle(t))).toBe(true);
    }
    const sbd = [
      ex("Competition Squat", { family: "squat", competitionLift: true }),
      ex("Competition Bench Press", { family: "bench", competitionLift: true }),
      ex("Competition Deadlift", { family: "deadlift", competitionLift: true }),
    ];
    expect(workoutDisplayTitle({ title: "Day 1", dayIndex: 1, exercises: sbd })).toBe("SBD");
  });

  it("names the main lifts by priority, not by exercise count", () => {
    const sqBench = [
      ex("Competition Squat", { family: "squat", competitionLift: true }),
      ex("Competition Bench Press", { family: "bench", competitionLift: true }),
      ex("Leg Press"), ex("Leg Extension"), ex("Leg Curl"), ex("Calf Raise"),
    ];
    expect(focusTitle(sqBench)).toBe("Squat & Bench");
    const dlSq = [
      ex("Competition Deadlift", { family: "deadlift", competitionLift: true }),
      ex("Pause Squat", { family: "squat", purposeLabel: "Secondary squat" }),
      ex("Lat Pulldown"), ex("Cable Row"),
    ];
    expect(focusTitle(dlSq)).toBe("Deadlift & Squat");
    expect(focusTitle([ex("Competition Deadlift", { family: "deadlift", competitionLift: true }), ex("Barbell Row"), ex("Lat Pulldown"), ex("Hammer Curl")])).toBe("Deadlift");
    expect(focusTitle([ex("Bench Press", { family: "bench", purposeLabel: "Primary" }), ex("Dumbbell Fly"), ex("Triceps Pushdown"), ex("Lateral Raise")])).toBe("Bench Press");
  });

  it("dumbbell and machine versions of a main lift are never a main lift", () => {
    expect(focusTitle([ex("Incline Dumbbell Bench Press", { family: "bench", primaryMuscle: "Chest" }), ex("Cable Fly", { primaryMuscle: "Chest" }), ex("Triceps Pushdown", { primaryMuscle: "Triceps" }), ex("Overhead Triceps Extension", { primaryMuscle: "Triceps" })])).toBe("Chest & Triceps");
  });

  it("a bodybuilding leg day that opens with an unflagged squat is Legs", () => {
    expect(focusTitle([ex("Back Squat", { family: "squat" }), ex("Leg Press"), ex("Romanian Deadlift"), ex("Leg Curl"), ex("Calf Raise")])).toBe("Legs");
  });

  it("reads the region from muscles and names", () => {
    expect(focusTitle([ex("Lat Pulldown"), ex("Seated Cable Row"), ex("Barbell Curl"), ex("Hammer Curl")])).toBe("Back & Biceps");
    expect(focusTitle([ex("Overhead Press", { primaryMuscle: "Shoulders" }), ex("Incline Press", { primaryMuscle: "Chest" }), ex("Lateral Raise", { primaryMuscle: "Shoulders" }), ex("Triceps Pushdown")])).toBe("Push");
    expect(focusTitle([ex("Pull-Up"), ex("Barbell Row"), ex("Face Pull", { primaryMuscle: "Rear Delts" }), ex("Shrug")])).toBe("Pull");
    expect(focusTitle([ex("Dumbbell Press", { primaryMuscle: "Chest" }), ex("Cable Row", { primaryMuscle: "Back" }), ex("Lateral Raise"), ex("Curl")])).toBe("Upper Body");
    expect(focusTitle([ex("Leg Press"), ex("Hip Thrust"), ex("Leg Curl"), ex("Plank"), ex("Cable Crunch"), ex("Pallof Press", { primaryMuscle: "Core" }), ex("Lat Pulldown", { sets: 2 })])).toBe("Lower Body");
    expect(focusTitle([ex("Goblet Squat", { primaryMuscle: "Quads" }), ex("Push-Up", { primaryMuscle: "Chest" }), ex("Dumbbell Row", { primaryMuscle: "Back" }), ex("Romanian Deadlift", { primaryMuscle: "Hamstrings" })])).toBe("Full Body");
  });

  it("adds Conditioning for a finisher, and a cardio-only day is Treadmill LISS", () => {
    expect(focusTitle([ex("Dumbbell Press", { primaryMuscle: "Chest" }), ex("Cable Row", { primaryMuscle: "Back" }), ex("Assault Bike Intervals")])).toBe("Upper Body & Conditioning");
    expect(focusTitle([ex("Incline Treadmill Walk")])).toBe("Treadmill LISS");
    expect(focusTitle([ex("Treadmill Walk", { planCardio: true })])).toBe("Treadmill LISS");
    // the day's cardio plan row never changes a lifting day's title
    expect(focusTitle([ex("Lat Pulldown"), ex("Cable Row"), ex("Curl"), ex("Treadmill Walk", { planCardio: true })])).toBe("Back & Biceps");
  });

  it("warm-ups and optional extras don't decide the title", () => {
    expect(focusTitle([
      ex("Hip Airplanes", { purposeLabel: "Warm-up" }),
      ex("Competition Bench Press", { family: "bench", competitionLift: true }),
      ex("Close Grip Bench", { family: "bench" }),
      ex("Leg Press", { optional: true }),
    ])).toBe("Bench Press");
  });

  it("a long coach name gets the focus title; never 'Workout' when there's better", () => {
    expect(workoutDisplayTitle({ title: "Heavy Lower Body Strength Emphasis With Pauses", exercises: [ex("Competition Squat", { family: "squat", competitionLift: true })] })).toBe("Squat");
    expect(workoutDisplayTitle({ title: "Workout", dayIndex: 3 })).toBe("Day 3");
    expect(workoutDisplayTitle({ title: "A very long name that keeps on going forever" }).length).toBeLessThanOrEqual(29);
  });

  it("reads a program row and an item", () => {
    const r = titleExerciseFromRow({ exercise_name_override: null, exercises: { name: "Competition Squat", movement_family: "squat", is_competition_lift: true }, sets: 4, cardio_target_id: null });
    expect(r).toMatchObject({ name: "Competition Squat", family: "squat", competitionLift: true, planCardio: false });
    expect(itemDisplayTitle({ display_title: "Push", day: { title: "Day 1" } })).toBe("Push");
    expect(itemDisplayTitle({ day: { title: "Day 2 (RPE 8)", day_index: 2 } })).toBe("Day 2");
  });
});
