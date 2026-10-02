import { describe, expect, it } from "vitest";
import {
  cascadeSetInput,
  defaultProgrammedSetInputs,
  inheritNewSetInputs,
  topEndProgrammedTarget,
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
