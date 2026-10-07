import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { exerciseClassifierSql } from "@/lib/exercise-classifier-sql";

const DIR = "supabase/migrations";

describe("exercise classifier: database twin", () => {
  it("newest migration defining exercise_classify matches the app's rules exactly", () => {
    // Changing a rule in exercise-classifier.ts? Paste exerciseClassifierSql()
    // into a new migration so new exercises keep getting tagged the same way.
    const latest = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(`${DIR}/${f}`, "utf8"))
      .filter((sql) => sql.includes("FUNCTION public.exercise_classify("))
      .pop();
    expect(latest, "no migration defines public.exercise_classify").toBeDefined();
    expect(latest).toContain(exerciseClassifierSql());
  });

  it("emits no regex escapes (JS and Postgres disagree on them)", () => {
    expect(exerciseClassifierSql()).not.toContain("\\");
  });

  it("wires new exercises to it", () => {
    const sql = readFileSync(`${DIR}/20261007200000_exercise_autotag_from_classifier.sql`, "utf8");
    expect(sql).toContain("FROM public.exercise_classify(_name, _category) k");
    expect(sql).toContain("BEFORE INSERT ON public.exercises");
  });
});
