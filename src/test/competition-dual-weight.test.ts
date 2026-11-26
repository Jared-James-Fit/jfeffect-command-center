import { describe, expect, it } from "vitest";
import { dualLoadText, inputKg, roundUpWeight } from "@/lib/dual-weight";
describe("meet plan weights", () => {
  it("keeps official kg and converted pounds together", () => {
    expect(dualLoadText(102.5, "kg")).toBe("102.5 kg (226 lb)");
    expect(roundUpWeight(inputKg(225, "lb"), 2.5)).toBe(102.5);
    expect(roundUpWeight(102.5, 2.5)).toBeNull();
  });
});
