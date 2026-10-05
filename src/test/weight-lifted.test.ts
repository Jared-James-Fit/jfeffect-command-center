import { describe, expect, it } from "vitest";
import { formatWeightLifted, formatWeightLiftedKg } from "@/lib/weight-lifted";

describe("formatWeightLifted", () => {
  it("handles empty and invalid totals", () => {
    expect(formatWeightLifted(0)).toBe("0 lb");
    expect(formatWeightLifted(-5)).toBe("0 lb");
    expect(formatWeightLifted(Number.NaN)).toBe("0 lb");
  });

  it("scales from lb to k to M", () => {
    expect(formatWeightLifted(842.4)).toBe("842 lb");
    expect(formatWeightLifted(1250)).toBe("1.3k lb");
    expect(formatWeightLifted(12_400)).toBe("12k lb");
    expect(formatWeightLifted(1_340_000)).toBe("1.3M lb");
    expect(formatWeightLifted(12_000_000)).toBe("12M lb");
  });
});

describe("formatWeightLiftedKg", () => {
  it("converts lb to kg", () => {
    expect(formatWeightLiftedKg(2204.6226)).toBe("1.0k kg");
    expect(formatWeightLiftedKg(220.46226)).toBe("100 kg");
    expect(formatWeightLiftedKg(0)).toBe("0 kg");
  });
});
