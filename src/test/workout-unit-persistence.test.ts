import { describe, it, expect } from "vitest";
import { persistedUnitForValue } from "@/lib/workout-unit-persistence";

describe("persistedUnitForValue — KG/LB toggle must not corrupt stored weight", () => {
  it("returns next unit when there is no existing row", () => {
    expect(persistedUnitForValue("100", "lb", null)).toBe("lb");
    expect(persistedUnitForValue("100", "kg", undefined)).toBe("kg");
  });

  it("preserves original entered unit when the raw value is unchanged", () => {
    // User logged 11 kg, then flipped the display toggle to LB. An unrelated
    // re-save (status tap, reps edit, autosave) must keep entered_unit=kg
    // so the DB trigger does not re-normalize 11 as 11 lb (= 5 kg).
    const existing = { actual_load: 11, actual_load_unit: "kg", entered_unit: "kg" };
    expect(persistedUnitForValue("11", "lb", existing)).toBe("kg");
    expect(persistedUnitForValue("11", "kg", existing)).toBe("kg");
  });

  it("adopts the new unit only when the user actually types a different number", () => {
    const existing = { actual_load: 11, actual_load_unit: "kg", entered_unit: "kg" };
    expect(persistedUnitForValue("135", "lb", existing)).toBe("lb");
  });

  it("regression: 100kg row toggled to LB and re-saved stays 100kg", () => {
    // (a) set a weight value of 100 (kg)
    const existing = { actual_load: 100, actual_load_unit: "kg", entered_unit: "kg" };
    // (b) toggle display unit from KG to LB — autosave fires with the same
    //     displayed string "100"
    const unitToWrite = persistedUnitForValue("100", "lb", existing);
    // (c) assert the unit written stays "kg" so the stored value
    //     (actual_load=100, entered_unit=kg) is NOT reinterpreted as 100 lb
    //     (which would normalize to 45.36 kg = the corruption bug).
    expect(unitToWrite).toBe("kg");
  });

  it("falls back to actual_load_unit when entered_unit is missing", () => {
    const existing = { actual_load: 50, actual_load_unit: "lb" };
    expect(persistedUnitForValue("50", "kg", existing)).toBe("lb");
  });
});