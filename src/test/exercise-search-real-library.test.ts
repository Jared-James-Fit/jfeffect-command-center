/**
 * Exercise search against the real library (Nov 20 2026 snapshot: 2,050
 * active exercises, names and tags only). Every case is how a lifter or coach
 * actually types: words in any order, gym shorthand, a slip of the thumb, the
 * equipment first, a muscle instead of a name, or a description.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isDescriptiveQuery,
  searchExercises,
  setExerciseAliasIndex,
  type SearchableExercise,
} from "@/lib/exercise-search";

type Fixture = { rows: string[][]; aliases: string[][] };
const fx = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "src/test/fixtures/exercise-library-2026-11.json"),
    "utf8",
  ),
) as Fixture;
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

beforeAll(() =>
  setExerciseAliasIndex(
    fx.aliases.map(([exercise_id, alias_name]) => ({ exercise_id, alias_name })),
  ),
);
afterAll(() => setExerciseAliasIndex([]));

const names = (q: string, n = 5) =>
  searchExercises(lib, q, { limit: 50 })
    .results.slice(0, n)
    .map((r) => r.exercise.name);
const top = (q: string) => names(q, 1)[0];

describe("names in any order", () => {
  it.each([
    ["cable lateral raise", "Cable Lateral Raises"],
    ["lateral raise cable", "Cable Lateral Raises"],
    ["raise lateral cable", "Cable Lateral Raises"],
    ["seated cable row", "Cable Seated Row"],
    ["row cable seated", "Cable Seated Row"],
    ["incline db press", "Incline Dumbbell Press"],
    ["dumbbell incline press", "Incline Dumbbell Press"],
    ["hip thrusts barbell", "Hip Thrust - Barbell"],
    ["barbell hip thrust", "Hip Thrust - Barbell"],
  ])("%s → %s first", (q, expected) => {
    expect(top(q)).toBe(expected);
  });

  it("a combination move never outranks the plain exercise asked for", () => {
    const list = names("lateral raise cable", 50);
    expect(list.indexOf("Cable Lateral Raises")).toBeLessThan(
      list.indexOf("Lateral Raise To Shoulder Press Resistance Band Cable"),
    );
  });
});

describe("gym shorthand, synonyms and equipment words", () => {
  it.each([
    ["side delt cable", "Cable Lateral Raises"],
    ["cable side raise", "Cable Lateral Raises"],
    ["rdl", "Romanian Deadlift"],
    ["db rdl", "Dumbbell Romanian Deadlift"],
    ["bb rdl", "Barbell Romanian Deadlift"],
    ["sldl", "Stiff-Leg Deadlift"],
    ["bss", "Bulgarian Split Squats"],
    ["ez curl", "EZ Bar Curl"],
    ["kb swing", "Kettlebell Swing"],
    ["hex bar deadlift", "Trap Bar Deadlift"],
    ["single arm db row", "Dumbbells Single Arm Row"],
    ["one arm dumbbell row", "Dumbbells Single Arm Row"],
    ["pec deck", "Pec Deck"],
    ["rear delt cable", "Rear Delt Cable Fly"],
    ["chinups", "Chin Ups"],
    ["legpress", "Leg Press"],
    ["hipthrust", "Bodyweight Hip Thrust"],
  ])("%s → %s first", (q, expected) => {
    expect(top(q)).toBe(expected);
  });

  it("an abbreviation means its exercise, not everything that shares a word", () => {
    // "RDL" used to make every deadlift a full match
    expect(names("rdl", 10).every((n) => /romanian|rdl/i.test(n))).toBe(true);
    // "BSS" is a Bulgarian split squat, not any split squat
    expect(names("bss db", 10).every((n) => /bulgarian/i.test(n))).toBe(true);
  });

  it("says why an abbreviation matched", () => {
    expect(searchExercises(lib, "rdl").results[0].reason).toMatch(/RDL = romanian deadlift/i);
  });

  it("OHP finds overhead / shoulder presses", () => {
    expect(names("ohp").every((n) => /overhead|shoulder|military/i.test(n))).toBe(true);
  });

  it("a muscle with the equipment finds that muscle's lifts on it", () => {
    expect(names("quads machine", 3)).toContain("Leg Extension - Machine");
    expect(names("side delts", 6).every((n) => /lateral raise/i.test(n))).toBe(true);
  });

  it("grip words count when the library uses them", () => {
    // "close grip bench" used to pull in Bench Pull Ups (grip words were optional)
    expect(names("close grip bench", 10).every((n) => /close/i.test(n))).toBe(true);
    expect(top("close grip bench")).toBe("Close-Grip Bench Press");
  });
});

describe("spelling slips, half-typed words and plurals", () => {
  it.each([
    ["romainian deadlift", "Romanian Deadlift"],
    ["bulgarain split squat", "Bulgarian Split Squats"],
    ["seated cabel row", "Cable Seated Row"],
    ["dumbel shoulder pres", "Dumbbell Shoulder Press"],
    ["tricep pushdwon", "Cable Triceps Pushdown"],
    ["goblet sqaut", "Goblet Squat"],
    ["preacher curls", "Preacher Curl"],
    ["calf raises", "Standing Calf Raise - Machine"],
  ])("%s → %s first", (q, expected) => {
    expect(top(q)).toBe(expected);
  });

  it("finds a lateral raise through two typos", () => {
    expect(names("latteral rase", 3).every((n) => /lateral raise/i.test(n))).toBe(true);
  });

  it("skull crushers, skullcrusher and skull crusher are one word", () => {
    for (const q of ["skull crushers", "skullcrusher", "skull crusher"]) {
      expect(names(q, 3).every((n) => /skull ?crusher/i.test(n))).toBe(true);
    }
  });

  it("a word the library has is never read as a typo of another", () => {
    // "spoto" used to also match "Barbell Lunges On The Spot"
    expect(names("spoto", 10).every((n) => /spoto/i.test(n))).toBe(true);
  });

  it("the closest completion of a half-typed word comes first", () => {
    expect(names("dumbbel pres", 3)).not.toContain("Dumbbell Preacher Curl");
    expect(names("pulld", 5).every((n) => /pull ?down/i.test(n))).toBe(true);
  });

  it("a muscle typed in full is never the start of another word", () => {
    // "lats" used to rank lateral raises
    expect(names("lats", 6).some((n) => /lateral/i.test(n))).toBe(false);
  });
});

describe("relevance: the answer, not a pile of loosely related exercises", () => {
  it("drops partial matches when something matches every word", () => {
    const r = searchExercises(lib, "chin ups", { limit: 100 });
    expect(r.results.every((x) => x.complete)).toBe(true);
    expect(r.results.map((x) => x.exercise.name)).not.toContain("Assisted Sit Ups");
  });

  it("puts stretches after working sets unless a stretch is asked for", () => {
    expect(top("rear delts")).not.toMatch(/stretch/i);
    expect(top("rear delt stretch")).toMatch(/stretch/i);
  });

  it("offers alternatives, said to be alternatives, when the exercise isn't in the library", () => {
    const r = searchExercises(lib, "t bar row");
    expect(r.hasExactMatches).toBe(false);
    expect(r.results[0].exercise.name).toMatch(/landmine row|chest supported row/i);
    expect(r.results[0].alternative).toBe(true);
    expect(r.results[0].reason).toMatch(/similar to/i);
  });

  it("a row is a pull to the body: upright rows only when asked for", () => {
    expect(names("cable row", 50).some((n) => /upright/i.test(n))).toBe(false);
    expect(top("upright row")).toMatch(/upright row/i);
  });

  it("an exact name always comes first", () => {
    for (const n of [
      "Pec Deck",
      "Larsen Press",
      "Pause Squat",
      "Box Squat",
      "Belt Squat",
      "Copenhagen Plank",
      "Side Plank",
      "Plank",
      "Dips",
      "Cable Fly",
      "Pendlay Row",
      "Chest Supported Row",
    ]) {
      expect(top(n)).toBe(n);
    }
  });

  it("camera-angle copies come after the exercise itself", () => {
    const list = names("bulgarian split squat", 6);
    expect(list[0]).not.toMatch(/\b(left|right|view)\b/i);
  });
});

describe("described instead of named", () => {
  it.each([
    ["that back exercise where you pull a cable toward your waist", /cable.*row|row.*cable/i],
    ["the one where you lie on your back and push your hips up", /glute bridge|hip thrust/i],
    ["exercise where you raise dumbbells out to the sides", /lateral raise/i],
    ["pull yourself up over a bar", /pull ?up|chin ?up/i],
    ["push a barbell over your head", /shoulders? press|overhead press|military/i],
    ["curl your legs on a machine", /leg curl|hamstring curl/i],
    ["stand on your toes with weight", /cal(f|ve)s? raise/i],
    ["shrug your shoulders up to your ears with dumbbells", /shrug/i],
    ["kick your legs out on a machine to work quads", /leg extension/i],
    ["pull a bar down to your chest while seated", /pull ?down/i],
    ["the thing where you hold a plank on one side", /side plank/i],
    ["cable thing for triceps where you push down", /push ?down/i],
    ["squat holding a dumbbell at your chest", /goblet/i],
    ["single leg exercise with back foot on a bench", /bulgarian/i],
  ])("%s", (q, expected) => {
    expect(isDescriptiveQuery(q)).toBe(true);
    expect(names(q, 3).every((n) => expected.test(n))).toBe(true);
  });

  it("a description's muscle refines it, never a word in the name", () => {
    expect(top("that back exercise where you pull a cable toward your waist")).toBe("Cable Seated Row");
  });

  it("a name with a few words is not a description", () => {
    expect(isDescriptiveQuery("single arm cable row")).toBe(false);
    expect(isDescriptiveQuery("incline dumbbell bench press")).toBe(false);
  });
});

describe("speed", () => {
  it("ranks the whole library fast enough for every keystroke", () => {
    searchExercises(lib, "warm the index");
    const qs = [
      "cable lateral raise",
      "rdl",
      "latteral rase",
      "seated cabel row",
      "that back exercise where you pull a cable toward your waist",
      "q",
      "be",
      "ben",
      "benc",
      "bench",
    ];
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) for (const q of qs) searchExercises(lib, q, { limit: 60 });
    const avg = (performance.now() - t0) / (qs.length * 3);
    expect(avg).toBeLessThan(25);
  });
});

describe("personal boost", () => {
  it("lifts the person's own exercise among equals, never above a better match", () => {
    const squats = searchExercises(lib, "squat").results;
    const someTie = squats[5].exercise;
    const boosted = searchExercises(lib, "squat", { boost: new Map([[someTie.id, 1]]) }).results;
    expect(boosted[0].exercise.id).toBe(someTie.id);
    // a boost never lifts a partial match over the exact name
    const pd = lib.find((e) => e.name === "Pec Deck")!;
    const other = lib.find((e) => e.name === "Machine Fly")!;
    const r = searchExercises(lib, "pec deck", { boost: new Map([[other.id, 1]]) }).results;
    expect(r[0].exercise.id).toBe(pd.id);
  });
});
