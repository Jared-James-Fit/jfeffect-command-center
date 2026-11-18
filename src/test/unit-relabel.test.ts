import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  RELABEL_WINDOW_MS,
  clearRelabel,
  markRelabel,
  numbersLine,
  relabelIntent,
  relabeledLoad,
  typedNumber,
  unitSwitchAsk,
  unitSwitchWords,
} from "@/lib/workouts/unit-relabel";

const read = (p: string) => readFileSync(p, "utf8");

describe("switching a card's unit with weights on it", () => {
  afterEach(() => clearRelabel());

  it("asks only when a weight is in the unit it's leaving", () => {
    expect(unitSwitchAsk([], "lb")).toBeNull();
    // every weight already in lb: nothing to ask, a plain switch
    expect(unitSwitchAsk([{ value: 20, unit: "lb" }], "lb")).toBeNull();
    // no weight (bodyweight / empty) never counts
    expect(unitSwitchAsk([{ value: 0, unit: "kg" }, { value: Number.NaN, unit: "kg" }], "lb")).toBeNull();
    expect(unitSwitchAsk([{ value: 20, unit: "kg" }, { value: 15, unit: "lb" }], "lb")).toEqual({ from: "kg", to: "lb", values: [20] });
    expect(unitSwitchAsk([{ value: 100, unit: "lb" }], "kg")).toEqual({ from: "lb", to: "kg", values: [100] });
  });

  it("says both answers in the person's own numbers", () => {
    // Jared's Cable Hip Abduction on Nov 17 2026: 20 typed on a card that opened in kg
    const one = unitSwitchWords(unitSwitchAsk([{ value: 20, unit: "kg" }], "lb")!);
    expect(one.title).toBe("Switch to lb");
    expect(one.question).toBe("20 kg is on this exercise. Was it lb?");
    expect(one.keep).toEqual({ label: "They were lb", detail: "Keep 20 lb" });
    expect(one.convert).toEqual({ label: "Convert to lb", detail: "20 kg = 44.1 lb" });
    const many = unitSwitchWords(unitSwitchAsk([{ value: 135, unit: "kg" }, { value: 185, unit: "kg" }, { value: 205, unit: "kg" }], "lb")!);
    expect(many.question).toBe("The weights on this exercise are in kg (135, 185 and 205). Were they lb?");
    expect(many.keep.detail).toBe("Keep 135, 185 and 205 as lb");
    expect(many.convert.detail).toBe("135 kg = 297.6 lb");
    const back = unitSwitchWords(unitSwitchAsk([{ value: 100, unit: "lb" }], "kg")!);
    expect(back.convert.detail).toBe("100 lb = 45.4 kg");
  });

  it("names each number once, and a long list by its first few", () => {
    expect(numbersLine([20, 20, 20])).toBe("20");
    expect(numbersLine([20, 25])).toBe("20 and 25");
    expect(numbersLine([20, 25, 30, 35, 40])).toBe("20, 25, 30 and 2 more");
    expect(typedNumber(72.5)).toBe("72.5");
    expect(typedNumber(142.8816)).toBe("142.88");
  });

  it("keeps the number a box shows, and a set already in the new unit shows its own number again", () => {
    // typed 20 on the kg card: stays 20, now lb
    expect(relabeledLoad("20", "kg", "lb", { value: 20, unit: "kg" })).toBe("20");
    // a draft nobody saved yet: its number stays too
    expect(relabeledLoad("25", "kg", "lb", null)).toBe("25");
    // a mixed card: set 3 was stored as 100 lb and showed 45.3592 kg on the kg card; back to lb it's 100, never 45.36 lb
    expect(relabeledLoad("45.3592", "kg", "lb", { value: 100, unit: "lb" })).toBe("100");
    expect(relabeledLoad("", "kg", "lb", { value: 100, unit: "lb" })).toBe("");
  });

  it("holds the intent only for the switch it was asked for, and only briefly", () => {
    expect(relabelIntent("lb", 1000)).toBe(false);
    markRelabel("lb", 1000);
    expect(relabelIntent("lb", 1000 + RELABEL_WINDOW_MS - 1)).toBe(true);
    expect(relabelIntent("kg", 1001)).toBe(false);
    expect(relabelIntent("lb", 1000 + RELABEL_WINDOW_MS)).toBe(false);
    markRelabel("lb", 2000);
    clearRelabel();
    expect(relabelIntent("lb", 2001)).toBe(false);
  });
});

describe("the logger wires it", () => {
  const view = read("src/components/workout-day/WorkoutDayView.tsx");
  const warmups = read("src/components/workout-day/final-warmup-input.tsx");
  it("the card's switch asks, the weight box's own pick never does", () => {
    expect(view).toContain("const ask = unitSwitchAsk(weighed, u);");
    expect(view).toContain("onKeep={() => { setUnitAsk(null); switchUnitNow(unitAsk.to, { relabel: true }); }}");
    expect(view).toContain("onSwitchUnit={!readonly && onUnitChange && !hideWeight ? switchUnitNow : undefined}");
  });
  it("a kept number is saved again by the set's own save, never adopted as already saved", () => {
    const effect = view.slice(view.indexOf("if (relabelIntent(unit)) {"), view.indexOf("// The toggle changes only the display representation."));
    expect(effect).toContain("relabeledLoad(load, previousUnit, unit");
    expect(effect).not.toContain("adoptShownAsSaved");
  });
  it("warm-ups keep their numbers too, and Undo puts the unit back the same way", () => {
    expect(view).toContain("if (relabelIntent(activeUnit) && !readonly) void relabelWarmups(activeUnit);");
    expect(warmups).toContain('await sb.from("pl_warmup_sets").update({ unit: to })');
    expect(view).toContain("if (opts?.relabel) markRelabel(prevUnit);");
  });
});
