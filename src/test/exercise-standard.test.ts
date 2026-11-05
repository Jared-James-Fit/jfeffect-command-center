import { describe, expect, it } from "vitest";
import { isLowValueExercise, meetsStandard, withStandardStrategy, withStandardSubstitutions } from "@/lib/program-intel/exercise-standard";
import { strategyStandardIssues } from "@/lib/program-intel/pipeline.server";

// names as they are in the exercise library
const BELOW = [
  "Landmine Lateral Raise",
  "Landmine Concentration Curl",
  "Landmine Bicep Curl",
  "Landmine Lying Tricep Extension",
  "Landmine Glute Kick Back",
  "Plate Front Raise",
  "Plate Rear Delt Fly",
  "Plate Overhead Tricep Extension",
  "Plate Halo",
  "Kettlebell Curl",
  "Kettlebell Skull Crusher",
  "Kettlebell Front Raise",
  "Kettlebell Single Arm Chest Fly",
  "Plate Lateral Raise",
  "Kettlebell Single Arm Lateral Raise",
  "Kettlebell Long Lever Lateral Raise",
  "Landmine Squat And Press",
  "Landmine Lunge To Overhead Press",
  "Landmine Alternating Lunge And Twist",
  "Landmine Alternating Lunge To Chest Press",
  "Landmine Rotational Lift To Press",
  "Dumbbell Squats To Shoulder Press",
  "Dumbbell Lateral To Front Raise",
  "Barbell Pullover To Triceps Extension",
  "Plate Glute Bridge To Chest Press",
  "Barbell Thruster",
  "Kettlebell Thruster",
  "Dumbbell Russian Twist",
  "Landmine Russian Twist",
  "Landmine Oblique Twist",
  "Barbell Landmine Side Bend",
  "Wall Sit",
  "Wall Squat Bodyweight",
  "Superman",
  "Superman Holds",
  "Dumbbell Seated On Exercise Ball Shoulder Press",
  "Dumbbell Incline Fly On Exercise Ball",
  "Balance Board Lateral Squat",
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
  "Touch and Go Bench Press",
  "Landmine Calf Raise",
  "Kettlebell Shrug",
  "Kettlebell Rear Delt Row",
  "Kettlebell Goblet Squat",
  "Goblet Kettlebell Squats",
  "Kettlebell Swing",
  "Kettlebell Single Leg Romanian Deadlifts",
  "Banded Feet Elevated Hip Thrusters",
  "Hip Thrust - Barbell",
  "45-Degree Back Extension",
  "Exercise Ball Leg Curl",
  "Crunch (On Stability Ball)",
  "Hammer Strength Plate Loaded High Row Both Arms",
  "Weighted Standing Shoulder Press With Plate",
  // stretches aren't working sets, so they're never judged
  "Side Bend Standing Lats Stretch",
  "Seated Figure Four With Twist Glute Stretch",
  "Easy Seated Twist Pose",
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

  it("a strategy gets one retry for these, then they're taken out (a coach's required pick stays)", () => {
    const s = {
      exercise_plan: {
        retain: [{ exercise_id: "a", name: "Landmine Lateral Raise", why: "" }, { exercise_id: "b", name: "Hack Squat", why: "" }],
        add: [{ name: "Wall Sit", why: "" }],
        replace: [{ exercise_id: null, name: "Lunge", with: "Landmine Lunge To Overhead Press", why: "" }],
      },
    };
    expect(strategyStandardIssues(s as any, { required: [] })).toHaveLength(3);
    expect(strategyStandardIssues(s as any, { required: [{ id: null, name: "Wall Sit" }] })).toHaveLength(2);
    const { strategy, removed } = withStandardStrategy(s);
    expect(strategy.exercise_plan.retain.map((r) => r.name)).toEqual(["Hack Squat"]);
    expect(strategy.exercise_plan.add).toEqual([]);
    expect(strategy.exercise_plan.replace[0].with).toBeNull();
    expect(removed.sort()).toEqual(["Landmine Lateral Raise", "Landmine Lunge To Overhead Press", "Wall Sit"]);
    expect(withStandardStrategy(s, [{ id: "a", name: "Landmine Lateral Raise" }]).strategy.exercise_plan.retain).toHaveLength(2);
    const fine = { exercise_plan: { retain: [{ exercise_id: "b", name: "Hack Squat" }], add: [], replace: [] } };
    expect(withStandardStrategy(fine).strategy).toBe(fine);
  });

  it("drops low-value substitutions only", () => {
    const block = { days: [{ exercises: [{ exercise_name: "Lateral Raises Dumbbell", substitutions: [{ exercise_name: "Landmine Lateral Raise" }, { exercise_name: "Cable Lateral Raises" }] }] }] };
    expect(withStandardSubstitutions(block).days[0].exercises[0].substitutions).toEqual([{ exercise_name: "Cable Lateral Raises" }]);
    const clean = { days: [{ exercises: [{ exercise_name: "Row", substitutions: [] }] }] };
    expect(withStandardSubstitutions(clean)).toBe(clean);
  });
});
