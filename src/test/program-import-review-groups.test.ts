/**
 * An import's review in three groups (Nov 24 2026): what needs the person,
 * what came in as written, and what's optional. A clean import reads as
 * clean, and the same problem across weeks is one item.
 */
import { describe, expect, it } from "vitest";
import type { PlanExercise, ProgramPlan } from "@/lib/program-plan";
import { reviewGroups, weekRun } from "@/lib/program-import/review-groups";

const ex = (key: string, p: Partial<PlanExercise> = {}): PlanExercise => ({
  key,
  exercise_id: "sq",
  name: "Competition Squat",
  sets: 3,
  reps: "5",
  ...p,
});

function plan(
  over: (w: number) => PlanExercise[] = () => [
    ex("a"),
    ex("b", { exercise_id: "bp", name: "Bench" }),
  ],
): ProgramPlan {
  return {
    v: 1,
    blocks: [
      {
        key: "b",
        name: "Block 1",
        weeks: Array.from({ length: 4 }, (_, i) => ({
          key: `w${i}`,
          days: [{ key: "d", title: "Lower", exercises: over(i) }],
        })),
      },
    ],
  };
}

describe("review groups", () => {
  it("a clean import needs nothing and says what came in", () => {
    const g = reviewGroups(plan(), []);
    expect(g.needs).toEqual([]);
    expect(g.blocking).toBe(0);
    expect(g.ready).toContain("All 2 exercise names matched to the library");
    expect(g.ready).toContain("Sets and reps on every exercise");
    expect(g.summary).toMatchObject({ weeks: 4, daysPerWeek: 1, blocks: 1, exercises: 2 });
  });

  it("an unmatched name is one item however many times it's used", () => {
    const g = reviewGroups(
      plan(() => [
        ex("a"),
        ex("x", { exercise_id: "", name: "Skull Crushers", source_name: "Skull Crushers" }),
      ]),
      [],
    );
    const u = g.needs.filter((n) => n.kind === "unmatched");
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ name: "Skull Crushers", count: 4 });
    expect(g.blocking).toBe(1);
    expect(g.ready[0]).toBe("1 of 2 exercise names matched to the library");
  });

  it("missing reps across weeks is one item with its weeks", () => {
    const g = reviewGroups(
      plan(() => [ex("a", { reps: "" })]),
      [],
    );
    const n = g.needs.find((x) => x.kind === "numbers");
    expect(n).toMatchObject({ what: "reps", weeks: [1, 2, 3, 4] });
  });

  it("a name matched under another library name is optional to confirm", () => {
    const g = reviewGroups(
      plan(() => [
        ex("a", { name: "Safety Squat Bar Squat", source_name: "SSB Squat", exercise_id: "ssb" }),
      ]),
      [],
    );
    expect(g.needs).toEqual([]);
    expect(g.optional[0]).toMatchObject({
      kind: "matched_as",
      fileName: "SSB Squat",
      libraryName: "Safety Squat Bar Squat",
      count: 4,
    });
  });

  it("a check from the read needs a look until it's marked looked at", () => {
    const flags = [{ level: "check" as const, code: "no_unit", text: "Squat: 100 has no unit" }];
    expect(reviewGroups(plan(), flags).needs).toHaveLength(1);
    expect(reviewGroups(plan(), flags, { dismissed: new Set(["f:no_unit:0"]) }).needs).toHaveLength(
      0,
    );
    // and never stops Save
    expect(reviewGroups(plan(), flags).blocking).toBe(0);
  });

  it("reads weeks plainly", () => {
    expect(weekRun([1, 2, 3, 5])).toBe("weeks 1–3, 5");
    expect(weekRun([2])).toBe("week 2");
  });
});
