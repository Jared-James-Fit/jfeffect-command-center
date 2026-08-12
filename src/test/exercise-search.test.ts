import { describe, expect, it } from "vitest";
import { searchExercises, type SearchableExercise } from "@/lib/exercise-search";

const lib: SearchableExercise[] = [
  { id: "1", name: "Incline Dumbbell Bench Press", muscle_group: "Chest", equipment: "Dumbbell", category: "Chest" },
  { id: "2", name: "Barbell Back Squat", muscle_group: "Quads", equipment: "Barbell", category: "Squat" },
  { id: "3", name: "Seated Hamstring Curl", muscle_group: "Hamstrings", equipment: "Machine", category: "Lower Body" },
  { id: "4", name: "Leg Extension - Machine", muscle_group: "Quads", equipment: "Machine", category: "Lower Body" },
  { id: "5", name: "Cable Lat Pulldown", muscle_group: "Lats", equipment: "Cable", category: "Back" },
  { id: "6", name: "Single-Leg Romanian Deadlift", muscle_group: "Hamstrings", equipment: "Dumbbell", category: "Lower Body" },
  { id: "7", name: "Triceps Pushdown", muscle_group: "Triceps", equipment: "Cable", category: "Arms" },
  { id: "8", name: "Cable Rear Delt Fly", muscle_group: "Rear Delts", equipment: "Cable", category: "Shoulders" },
  { id: "9", name: "Hack Squat", muscle_group: "Quads", equipment: "Machine", category: "Lower Body" },
  { id: "10", name: "Dumbbell Shoulder Press", muscle_group: "Front Delts", equipment: "Dumbbell", category: "Shoulders" },
];

const top = (q: string) => searchExercises(lib, q).results[0]?.exercise.name;
const names = (q: string) => searchExercises(lib, q).results.map((r) => r.exercise.name);

describe("exercise search", () => {
  it("matches out-of-order tokens", () => {
    expect(top("bench incline dumbbell")).toBe("Incline Dumbbell Bench Press");
    expect(top("curl ham seated")).toBe("Seated Hamstring Curl");
    expect(top("extension leg machine")).toBe("Leg Extension - Machine");
    expect(top("lat pulldown cable")).toBe("Cable Lat Pulldown");
  });

  it("supports aliases", () => {
    expect(names("db press")).toContain("Incline Dumbbell Bench Press");
    expect(top("bb squat")).toBe("Barbell Back Squat");
    expect(names("rdl")).toContain("Single-Leg Romanian Deadlift");
    expect(top("tri pushdown")).toBe("Triceps Pushdown");
  });

  it("matches muscle and equipment terms", () => {
    expect(names("quad machine")).toEqual(expect.arrayContaining(["Leg Extension - Machine", "Hack Squat"]));
    expect(names("rear delt cable")).toContain("Cable Rear Delt Fly");
    expect(names("dumbbell shoulder")).toContain("Dumbbell Shoulder Press");
  });

  it("supports partial words and typos", () => {
    expect(names("pulld")).toContain("Cable Lat Pulldown");
    expect(names("dumbell press")).toContain("Dumbbell Shoulder Press");
  });

  it("reports when only close matches exist", () => {
    const r = searchExercises(lib, "zercher carry");
    expect(r.hasExactMatches).toBe(false);
  });

  it("returns the full list for an empty query", () => {
    expect(searchExercises(lib, "  ").results).toHaveLength(lib.length);
  });
});
