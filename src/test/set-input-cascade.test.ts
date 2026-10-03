import { describe, expect, it } from "vitest";
import {
  cascadeSetInput,
  defaultProgrammedSetInputs,
  inheritNewSetInputs,
  topEndProgrammedTarget,
  parseRepTarget,
} from "@/lib/set-input-cascade";

describe("programmed set input defaults", () => {
  it("uses the top end of rep and RPE ranges", () => {
    expect(topEndProgrammedTarget("6–10")).toBe(10);
    expect(topEndProgrammedTarget("RPE 7-8")).toBe(8);
    expect(topEndProgrammedTarget("5")).toBe(5);
  });

  it("fills blank reps/RPE without overwriting logged values", () => {
    const sets = defaultProgrammedSetInputs(
      [{ reps: null, rpe: null }, { reps: 8, rpe: 7 }, { reps: "", rpe: "" }],
      { reps: "6-10", rpe: "7-8" },
    );
    expect(sets).toEqual([
      { reps: 10, rpe: 8 },
      { reps: 8, rpe: 7 },
      { reps: 10, rpe: 8 },
    ]);
  });

  it("cascades a changed value downward only", () => {
    const sets = [{ reps: 10 }, { reps: 10 }, { reps: 10 }];
    expect(cascadeSetInput(sets, 1, "reps", 8)).toEqual([
      { reps: 10 }, { reps: 8 }, { reps: 8 },
    ]);
  });

  it("new sets inherit the most recent reps, RPE and weight", () => {
    expect(inheritNewSetInputs(
      [{ reps: 8, rpe: 7, weight: 20 }],
      { reps: null, rpe: null, weight: null },
      { reps: "6-10", rpe: "7-8" },
    )).toEqual({ reps: 8, rpe: 7, weight: 20 });
  });
});

describe("parseRepTarget (real prescription formats)", () => {
  it.each([
    ["6–10", { min: 6, max: 10 }],
    ["6-10", { min: 6, max: 10 }],
    ["6—10", { min: 6, max: 10 }],
    ["6 to 10", { min: 6, max: 10 }],
    ["8-12 per leg", { min: 8, max: 12 }],
    ["8–10 per leg", { min: 8, max: 10 }],
    ["10-12 each side", { min: 10, max: 12 }],
    ["12-15 per arm", { min: 12, max: 15 }],
    ["8-12/leg", { min: 8, max: 12 }],
    ["8-12 / side", { min: 8, max: 12 }],
    ["6-10 reps", { min: 6, max: 10 }],
    ["8", { exact: 8 }],
    ["8 per leg", { exact: 8 }],
    ["10 each side", { exact: 10 }],
  ])("%s", (text, expected) => {
    expect(parseRepTarget(text)).toEqual(expected);
  });

  it.each(["30 seconds", "30-45 sec/side", "25-45 seconds", "45s", "2 min", "AMRAP", "12, 6, 12", "2/3/4/5", "4/5", ""])(
    "is not a rep range: %s",
    (text) => {
      const t = parseRepTarget(text);
      expect(t.max).toBeUndefined();
      if (/sec|min|\ds\b|AMRAP|,|\//i.test(text) || !text) expect(t).toEqual({});
    },
  );
});
