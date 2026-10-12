import { describe, expect, it } from "vitest";
import { formatDualLoad } from "@/lib/dual-load";

describe("formatDualLoad", () => {
  it("shows lb / kg with the prescribed unit exact", () => {
    expect(formatDualLoad(225, "lb")).toBe("225 lb / 102 kg");
    // a coach's 175 kg shown in lb: no "385.81 lb"
    expect(formatDualLoad(175 * 2.2046226218, "lb")).toBe("386 lb / 175 kg");
    expect(formatDualLoad(132.5, "lb")).toBe("132.5 lb / 60 kg");
    expect(formatDualLoad(100, "kg")).toBe("220 lb / 100 kg");
    expect(formatDualLoad(102.5, "kg")).toBe("226 lb / 102.5 kg");
  });

  it("keeps decimals of the prescribed unit and rounds only the other unit", () => {
    expect(formatDualLoad(137.5, "lb")).toBe("137.5 lb / 62.5 kg");
  });

  it("is safe on bad input", () => {
    expect(formatDualLoad(Number.NaN, "kg")).toBe("");
  });
});
