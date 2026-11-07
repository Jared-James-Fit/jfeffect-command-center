import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { overCapAsPounds, validateTypedWeight, WEIGHT_CAP } from "@/lib/workout-weight-input";

const read = (f: string) => readFileSync(f, "utf8");
const cell = read("src/components/workout-day/weight-value-input.tsx");
const view = read("src/components/workout-day/WorkoutDayView.tsx");

// Nov 7 2026: Jared McIntyre typed 495 (pounds) for his deadlift on a kg card.
// 495 kg is over the 450 kg cap, and leaving the box (an iPhone number pad has
// no Done key) threw it away without a word, every time.
describe("a weight over the cap is asked about, never dropped", () => {
  it("495 on a kg card is over the kg cap and a normal number of pounds", () => {
    const res = validateTypedWeight("495", "kg");
    expect(res).toEqual({ ok: true, value: 495, aboveCap: true });
    expect(overCapAsPounds(495, "kg")).toBe(true);
    expect(overCapAsPounds(1000, "kg")).toBe(true);
  });

  it("only kg numbers too heavy as kg are offered as lb", () => {
    expect(overCapAsPounds(225, "kg")).toBe(false); // a real kg weight
    expect(overCapAsPounds(WEIGHT_CAP.kg, "kg")).toBe(false);
    expect(overCapAsPounds(1200, "kg")).toBe(false); // too heavy as lb too
    expect(overCapAsPounds(495, "lb")).toBe(false); // already lb
    expect(overCapAsPounds(Number.NaN, "kg")).toBe(false);
  });

  it("leaving the box with an over-cap number opens the question instead of cancelling", () => {
    expect(cell).toContain("if (res.aboveCap) { askAboveCap(res.value); return; }");
    expect(cell).not.toContain("if (!res.ok || res.aboveCap) { cancelEditing(); return; }");
    // Done and leaving the box take the same path
    expect(cell.match(/askAboveCap\(res\.value\)/g)?.length).toBe(2);
  });

  it("the question offers the number as lb first, which picks in lb", () => {
    expect(cell).toContain('commitWeight({ load: String(confirmValue), bodyweight: false, loadType: "external", unit: "lb" })');
    expect(cell).toContain("Did you mean {confirmValue} lb?");
    expect(cell).toContain("Switches this exercise to lb");
  });

  it("the sheet sits on <body> and holds Focus's swipes", () => {
    expect(cell).toContain("createPortal(");
    expect(cell).toContain('role="dialog" aria-modal="true" aria-label={ariaLabel} data-state="open"');
    expect(read("src/components/workout-day/workout-story.tsx")).toContain('[role="dialog"][data-state="open"]');
  });

  it("a pick in the other unit switches the card first, then saves once the switch has rendered", () => {
    expect(view).toContain("unitPickRef.current = { ...next, unit: next.unit, at: Date.now() };");
    expect(view).toContain("onSwitchUnit(next.unit);");
    expect(view).toContain("if (pick && pick.unit === unit && Date.now() - pick.at < UNIT_PICK_WAIT_MS) {");
    expect(view).toContain("onSwitchUnit={!readonly && onUnitChange && !hideWeight ? handleUnitToggle : undefined}");
    expect(view).toContain("canSwitchUnit={!!onSwitchUnit}");
    // the pick is applied before the switch's own conversion, never converted
    const effect = view.slice(view.indexOf("const pick = unitPickRef.current;"), view.indexOf("const current = Number(load);"));
    expect(effect).toContain("applyWeightPick(pick);\n      return;");
  });
});
