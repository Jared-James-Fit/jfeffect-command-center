/**
 * An imported program's names matched to the real library (Nov 20 2026
 * snapshot): gym shorthand finds the exercise it means, and a library name
 * that's a different movement (archer pull-ups for "pull ups", a cable fly for
 * "incline bench", a GHR sit-up for "GHR") is offered to pick, never taken.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setExerciseAliasIndex, type SearchableExercise } from "@/lib/exercise-search";
import { extraWords, matchExerciseNames, nameKey, neutralFor } from "@/lib/program-import/match";

const fx = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "src/test/fixtures/exercise-library-2026-11.json"),
    "utf8",
  ),
) as {
  rows: string[][];
  aliases: string[][];
};
const lib: SearchableExercise[] = fx.rows.map((r) => ({
  id: r[0],
  name: r[1],
  equipment: r[2] || null,
  muscle_group: r[3] || null,
  primary_movement_pattern: r[4] || null,
  category: r[5] || null,
  exercise_family: r[6] || null,
  muscle_groups: r[7] ? r[7].split(" ") : [],
}));
const aliases = fx.aliases.map(([exercise_id, alias_name]) => ({ exercise_id, alias_name }));
beforeAll(() => setExerciseAliasIndex(aliases));
afterAll(() => setExerciseAliasIndex([]));

const match = (name: string) => matchExerciseNames(lib, [name], aliases).get(nameKey(name))!;

describe("importing names a lifter writes", () => {
  it.each([
    ["SSB Squat", "Safety Squat Bar Squat"],
    ["SSB", "Safety Squat Bar Squat"],
    ["RDL", "Romanian Deadlift"],
    ["DB RDL", "Dumbbell Romanian Deadlift"],
    ["Comp Squat", "Competition Squat"],
    ["Incline DB Press", "Incline Dumbbell Press"],
    ["Pull Ups", "Pull Up Normal Grip"],
    ["Lat Pulldown", "Lat Pull Down Normal Grip"],
    ["Incline Bench", "Barbell Incline Bench Press"],
    ["Tricep Pushdown", "Cable Triceps Pushdown"],
    ["Hammer Curls", "Dumbbell Hammer Curl"],
    ["Face Pulls", "Face Pull - Cable"],
    ["OHP", "Barbell Shoulder Press"],
    ["Barbell Row", "Bent-Over Barbell Row"],
  ])("%s → %s", (name, want) => {
    const m = match(name);
    expect(m.status).not.toBe("none");
    expect(m.exercise?.name).toBe(want);
  });

  it.each(["GHR", "Ab Wheel", "Skull Crushers", "Single Leg RDL", "Bike", "Board Press"])(
    "%s is offered to pick, never taken as another movement",
    (name) => {
      const m = match(name);
      expect(m.status).toBe("none");
      expect(m.exercise).toBeNull();
    },
  );

  it("offers the likeliest exercise first when it can't decide", () => {
    expect(match("Skull Crushers").options.length).toBeGreaterThan(0);
    expect(match("Single Leg RDL").options[0].name).toMatch(/Single Leg Romanian Deadlift/i);
  });

  it("never takes a different movement for a plain name", () => {
    expect(match("Pull Ups").exercise?.name).not.toMatch(/archer|assisted/i);
    expect(match("Incline Bench").exercise?.name).not.toMatch(/fly/i);
    expect(match("Barbell Row").exercise?.name).not.toMatch(/lying|meadows/i);
  });

  it("knows a movement's default equipment", () => {
    expect(neutralFor("Tricep Pushdowns").has("cable")).toBe(true);
    expect(neutralFor("Hammer Curls").has("dumbbell")).toBe(true);
    expect(neutralFor("Ab Wheel").has("barbell")).toBe(false);
    expect(extraWords("Pull Up Normal Grip", ["Pull Up"])).toEqual(["normal", "grip"]);
  });
});
