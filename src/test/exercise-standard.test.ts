import { describe, expect, it } from "vitest";
import { isLowValueExercise, meetsStandard, withStandardSubstitutions } from "@/lib/program-intel/exercise-standard";

// names as they are in the exercise library
const BELOW = [
  "Landmine Lateral Raise",
  "Landmine Concentration Curl",
  "Landmine Bicep Curl",
  "Landmine Lying Tricep Extension",
  "Landmine Calf Raise",
  "Landmine Glute Kick Back",
  "Plate Lateral Raise",
  "Kettlebell Single Arm Lateral Raise",
  "Kettlebell Long Lever Lateral Raise",
  "Landmine Squat And Press",
  "Landmine Lunge To Overhead Press",
  "Landmine Alternating Lunge And Twist",
  "Landmine Alternating Lunge To Chest Press",
  "Landmine Rotational Lift To Press",
  "Dumbbell Russian Twist",
  "Landmine Russian Twist",
  "Landmine Oblique Twist",
  "Barbell Landmine Side Bend",
  "Wall Sit",
  "Lateral Raise Bodyweight",
  "Lying Lateral Raises Bodyweight",
  "Laying Lateral Raise",
  "Arms Lateral Raise And Rotation Up",
  "Crunch (On Bosu Ball)",
];

const FINE = [
  "Landmine Row",
  "Single-Arm Landmine Press",
  "Landmine Belt Squat",
  "Landmine Romanian Deadlift",
  "Landmine B Stance Romanian Deadlift",
  "Landmine Single-Leg Romanian Deadlift",
  "Landmine Reverse Lunge",
  "Landmine Hack Squat",
  "Lateral Raise Dumbbell - Constant Tension",
  "Lateral Raises Dumbbell",
  "Cable Lateral Raises",
  "Machine Lateral Raise",
  "Side Lateral Raise Resistance Band",
  "Lateral Raise",
  "EZ Bar Curl",
  "Cable Crunch",
  "Reverse Crunch",
  "Pallof Press",
  "Hack Squat",
  "Box Squat",
  "3-0-0 Tempo to Knee Sumo Deadlift",
  "Two-Count Paused Conventional Deadlift Below Knee",
  "Bulgarian Split Squats",
  "Nordic Hamstring Curl",
  "Seated Leg Curl Machine",
  "Close-Grip Bench Press",
];

describe("exercise standard", () => {
  it.each(BELOW)("%s is below the standard", (n) => expect(isLowValueExercise(n)).toBe(true));
  it.each(FINE)("%s meets it", (n) => expect(isLowValueExercise(n)).toBe(false));

  it("keeps a coach's required pick in the catalog", () => {
    const list = [
      { id: "a", name: "Landmine Lateral Raise" },
      { id: "b", name: "Cable Lateral Raises" },
      { id: "c", name: "Wall Sit" },
    ];
    expect(meetsStandard(list).map((e) => e.id)).toEqual(["b"]);
    expect(meetsStandard(list, [{ id: "c", name: "Wall Sit" }]).map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("drops low-value substitutions only", () => {
    const block = { days: [{ exercises: [{ exercise_name: "Lateral Raises Dumbbell", substitutions: [{ exercise_name: "Landmine Lateral Raise" }, { exercise_name: "Cable Lateral Raises" }] }] }] };
    expect(withStandardSubstitutions(block).days[0].exercises[0].substitutions).toEqual([{ exercise_name: "Cable Lateral Raises" }]);
    const clean = { days: [{ exercises: [{ exercise_name: "Row", substitutions: [] }] }] };
    expect(withStandardSubstitutions(clean)).toBe(clean);
  });
});
