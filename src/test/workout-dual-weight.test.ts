import { describe, expect, it } from "vitest";
import { displayedLoadOther } from "@/lib/dual-weight";
import { readFileSync } from "node:fs";

describe("workout weight equivalents", () => {
  it("converts the visible unit exactly once", () => {
    expect(displayedLoadOther("225", "lb")).toBe("102.1 kg");
    expect(displayedLoadOther(102.5, "kg")).toBe("226 lb");
    expect(displayedLoadOther(0, "kg")).toBe("0 lb");
  });
  it("does not invent a bodyweight or missing load", () => {
    for (const v of ["", "  ", null, undefined, "bad", -5, Infinity]) expect(displayedLoadOther(v, "kg")).toBeNull();
    expect(displayedLoadOther(0, "kg", true)).toBeNull();
  });
  it("keeps the same logger input and commit path", () => {
    const cell = readFileSync("src/components/workout-day/weight-value-input.tsx", "utf8");
    expect(cell).toContain("displayedLoadOther(ghost ?? numeric, unit, loadType === \"bodyweight\")");
    expect(cell).toContain("data-weight-other");
    expect(cell).toContain("onBlur={handleBlur}");
    expect(cell).toContain("submitTyped()");
  });
});
