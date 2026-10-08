import { afterEach, describe, expect, it } from "vitest";
import {
  findCanonicalExerciseMatch,
  searchExercises,
  setExerciseAliasIndex,
  type SearchableExercise,
} from "@/lib/exercise-search";

const lib: SearchableExercise[] = [
  { id: "csq", name: "Competition Squat", category: "Squat", equipment: "Barbell" },
  { id: "hbs", name: "High Bar Squat", category: "Squat", equipment: "Barbell" },
  { id: "pause", name: "Pause Squat", category: "Squat", equipment: "Barbell" },
  { id: "cbp", name: "Competition Bench Press", category: "Bench", equipment: "Barbell" },
  { id: "bbp", name: "Barbell Bench Press", category: "Bench", equipment: "Barbell" },
  { id: "cdl", name: "Competition Deadlift", category: "Deadlift", equipment: "Barbell" },
  { id: "rdl", name: "Romanian Deadlift", category: "Deadlift", equipment: "Barbell" },
  { id: "drdl", name: "Dumbbell Romanian Deadlift", category: "Deadlift", equipment: "Dumbbell" },
  { id: "fly-hl", name: "Chest Fly High To Low", category: "Chest" },
  { id: "fly-lh", name: "Chest Fly Low To High", category: "Chest" },
];

const aliases = [
  { exercise_id: "csq", alias_name: "Comp Squat" },
  { exercise_id: "csq", alias_name: "Low Bar Squat" },
  { exercise_id: "csq", alias_name: "Barbell Low Bar Squat" },
  { exercise_id: "csq", alias_name: "Competition Back Squat" },
  { exercise_id: "cbp", alias_name: "Comp Bench" },
  { exercise_id: "cbp", alias_name: "Competition Bench" },
  { exercise_id: "cdl", alias_name: "Comp Deadlift" },
  { exercise_id: "rdl", alias_name: "RDL" },
];

const top = (q: string) => searchExercises(lib, q).results[0]?.exercise.name;

afterEach(() => setExerciseAliasIndex([]));

describe("alias-aware exercise search", () => {
  it("without aliases, 'low bar' finds nothing useful (baseline)", () => {
    expect(searchExercises(lib, "low bar").results.find((r) => r.exercise.id === "csq" && r.complete)).toBeUndefined();
  });

  it("'low bar' returns Competition Squat", () => {
    setExerciseAliasIndex(aliases);
    expect(top("low bar")).toBe("Competition Squat");
  });

  it("'comp bench' returns Competition Bench Press", () => {
    setExerciseAliasIndex(aliases);
    expect(top("comp bench")).toBe("Competition Bench Press");
  });

  it("'RDL' returns Romanian Deadlift first", () => {
    setExerciseAliasIndex(aliases);
    expect(top("RDL")).toBe("Romanian Deadlift");
    expect(top("rdl")).toBe("Romanian Deadlift");
  });

  it("returns the CANONICAL exercise (never an alias row) and says why it matched", () => {
    setExerciseAliasIndex(aliases);
    const hit = searchExercises(lib, "low bar squat").results[0];
    expect(hit.exercise.id).toBe("csq");
    expect(hit.exercise.name).toBe("Competition Squat");
    expect(hit.reason).toContain("Low Bar Squat");
    expect(searchExercises(lib, "comp deadlift").results[0].exercise.name).toBe("Competition Deadlift");
  });

  it("an exercise appears once even when several of its aliases match", () => {
    setExerciseAliasIndex(aliases);
    const ids = searchExercises(lib, "squat").results.map((r) => r.exercise.id);
    expect(ids.filter((id) => id === "csq")).toHaveLength(1);
  });

  it("does not leak aliases onto unrelated exercises", () => {
    setExerciseAliasIndex(aliases);
    const ids = searchExercises(lib, "low bar").results.filter((r) => r.complete).map((r) => r.exercise.id);
    expect(ids).toContain("csq");
    expect(ids).not.toContain("cbp");
    expect(ids).not.toContain("hbs");
  });

  it("an exercise can also carry its own aliases (no registry needed)", () => {
    const pool = [{ id: "x", name: "Safety Bar Squat", aliases: ["SSB Squat"] }];
    expect(searchExercises(pool, "ssb").results[0]?.exercise.name).toBe("Safety Bar Squat");
  });
});

describe("duplicate prevention lookup", () => {
  const rows = [...lib];

  it("reuses an exact canonical name", () => {
    expect(findCanonicalExerciseMatch(rows, "Competition Squat")?.id).toBe("csq");
  });

  it("reuses via an alias", () => {
    expect(findCanonicalExerciseMatch(rows, "Comp Bench", aliases)?.id).toBe("cbp");
    expect(findCanonicalExerciseMatch(rows, "Barbell Low Bar Squat", aliases)?.id).toBe("csq");
    expect(findCanonicalExerciseMatch(rows, "rdl", aliases)?.id).toBe("rdl");
  });

  it("reuses via spelling / plural / DB-BB equivalents", () => {
    expect(findCanonicalExerciseMatch(rows, "Competition Squats")?.id).toBe("csq");
    expect(findCanonicalExerciseMatch(rows, "DB Romanian Deadlift")?.id).toBe("drdl");
  });

  it("reuses the same words in a different order", () => {
    expect(findCanonicalExerciseMatch(rows, "Squat Pause")?.id).toBe("pause");
    expect(findCanonicalExerciseMatch(rows, "Bench Press Competition")?.id).toBe("cbp");
  });

  it("does not collapse genuinely different variations", () => {
    expect(findCanonicalExerciseMatch(rows, "Tempo Squat", aliases)).toBeNull();
    expect(findCanonicalExerciseMatch(rows, "Pause Bench Press", aliases)).toBeNull();
    expect(findCanonicalExerciseMatch(rows, "Safety Bar Squat", aliases)).toBeNull();
  });

  it("keeps opposite directions apart", () => {
    expect(findCanonicalExerciseMatch(rows, "Chest Fly High To Low")?.id).toBe("fly-hl");
    expect(findCanonicalExerciseMatch(rows, "Chest Fly Low To High")?.id).toBe("fly-lh");
    expect(findCanonicalExerciseMatch(rows, "Low To High Chest Fly")).toBeNull();
  });

  it("ignores archived exercises", () => {
    expect(findCanonicalExerciseMatch([{ id: "z", name: "Pause Squat", archived: true }], "Pause Squat")).toBeNull();
  });
});
