import { describe, it, expect } from "vitest";
import { isSetLogComplete } from "@/lib/set-completion";

describe("isSetLogComplete", () => {
  it("completes a weighted set", () => {
    expect(isSetLogComplete({ measurementType: "reps", loadType: "external", load: "100", reps: "8" })).toBe(true);
  });
  it("completes a bodyweight set with no numeric load", () => {
    expect(isSetLogComplete({ loadType: "bodyweight", load: "", reps: "10" })).toBe(true);
  });
  it("completes an assisted set", () => {
    expect(isSetLogComplete({ loadType: "assisted", load: 40, reps: 8 })).toBe(true);
  });
  it("treats 0 load as entered", () => {
    expect(isSetLogComplete({ loadType: "external", load: 0, reps: 8 })).toBe(true);
  });
  it("is incomplete without reps", () => {
    expect(isSetLogComplete({ loadType: "external", load: 100, reps: "" })).toBe(false);
  });
  it("is incomplete without load", () => {
    expect(isSetLogComplete({ loadType: "external", load: null, reps: 8 })).toBe(false);
  });
  it("ignores load when the row hides weight", () => {
    expect(isSetLogComplete({ hideWeight: true, load: null, reps: 8 })).toBe(true);
  });
  it("uses duration for timed rows", () => {
    expect(isSetLogComplete({ measurementType: "time", durationSeconds: 45 })).toBe(true);
    expect(isSetLogComplete({ measurementType: "time", durationSeconds: 0 })).toBe(false);
  });
});
