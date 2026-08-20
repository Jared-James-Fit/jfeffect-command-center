import { describe, expect, it } from "vitest";
import {
  displayLoadInUnit,
  equalDisplayLoads,
  persistedLoadForDisplayValue,
  persistedUnitForValue,
} from "@/lib/workout-unit-persistence";

describe("workout unit contract — display conversion never rewrites the original entered pair", () => {
  const ninetyKg = {
    actual_load: 90,
    actual_load_unit: "kg",
    entered_value: 90,
    entered_unit: "kg",
    normalized_kg: 90,
    normalized_lb: 198.415,
  };

  it("renders a stored KG result truthfully in LB without relabeling its raw number", () => {
    const existing = ninetyKg;
    expect(displayLoadInUnit(existing, "kg")).toBe(90);
    expect(displayLoadInUnit(existing, "lb")).toBeCloseTo(198.415, 2);
  });

  it("preserves the original KG pair when the LB display is saved without a physical edit", () => {
    const existing = { actual_load: 90, actual_load_unit: "kg", entered_value: 90, entered_unit: "kg" };
    const persisted = persistedLoadForDisplayValue("198.415", "lb", existing);
    expect(persisted).toEqual({ value: 90, unit: "kg" });
    expect(persistedUnitForValue("198.415", "lb", existing)).toBe("kg");
  });

  it("preserves an original LB pair when the KG display is saved without a physical edit", () => {
    const existing = { actual_load: 220, actual_load_unit: "lb", entered_value: 220, entered_unit: "lb" };
    const persisted = persistedLoadForDisplayValue("99.7903", "kg", existing);
    expect(persisted).toEqual({ value: 220, unit: "lb" });
  });

  it("adopts the active display unit only after a genuine physical-load edit", () => {
    const existing = { actual_load: 90, actual_load_unit: "kg", entered_value: 90, entered_unit: "kg" };
    expect(persistedLoadForDisplayValue("205", "lb", existing)).toEqual({ value: 205, unit: "lb" });
  });

  it("treats equivalent KG/LB display values as equal for autosave gating", () => {
    expect(equalDisplayLoads({ load: "90", unit: "kg" }, { load: "198.415", unit: "lb" })).toBe(true);
    expect(equalDisplayLoads({ load: "90", unit: "kg" }, { load: "205", unit: "lb" })).toBe(false);
  });

  it("falls back to legacy actual fields when entered metadata is absent", () => {
    const existing = { actual_load: 50, actual_load_unit: "lb" };
    expect(displayLoadInUnit(existing, "kg")).toBeCloseTo(22.6796, 3);
    expect(persistedLoadForDisplayValue("22.6796", "kg", existing)).toEqual({ value: 50, unit: "lb" });
  });
});


describe("workout unit contract — persisted mirror compatibility", () => {
  it("uses actual_load_kg/lb mirrors when normalized aliases are absent", () => {
    const legacy = {
      actual_load: 90,
      actual_load_unit: "kg",
      actual_load_kg: 90,
      actual_load_lb: 198.415,
    };
    expect(displayLoadInUnit(legacy, "kg")).toBe(90);
    expect(displayLoadInUnit(legacy, "lb")).toBeCloseTo(198.415, 2);
  });
});
