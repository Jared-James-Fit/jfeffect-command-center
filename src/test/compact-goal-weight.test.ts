import { describe, expect, it } from "vitest";
import { dualRange, inputKg, kgIn, roundUpWeight } from "@/lib/dual-weight";

describe("compact goal weight", () => {
  it("preserves exact source and displays both units", () => {
    const kg = inputKg(225, "lb");
    expect(kgIn(kg, "lb")).toBeCloseTo(225, 10);
    expect(dualRange(kg, null, "kg", "lb")).toEqual({ unit: "kg", primary: "102.1 kg", secondary: "225 lb" });
    expect(dualRange(inputKg(220, "lb"), kg, "kg", "lb").primary).toBe("99.8–102.1 kg");
  });
  it("rounds up only when needed and uses the meet's increment", () => {
    expect(roundUpWeight(inputKg(225, "lb"), 2.5)).toBe(102.5);
    expect(roundUpWeight(102.5, 2.5)).toBeNull();
    expect(roundUpWeight(102.1, 5)).toBe(105);
    expect(roundUpWeight(102.1, 0.5)).toBe(102.5);
    expect(roundUpWeight(0, 2.5)).toBeNull();
    expect(roundUpWeight(NaN, 2.5)).toBeNull();
  });
});
