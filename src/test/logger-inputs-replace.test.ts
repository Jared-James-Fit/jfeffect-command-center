import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { WeightValueInput } = await import("@/components/workout-day/weight-value-input");
const { WarmupRows } = await import("@/components/workout-day/final-warmup-input");

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(WeightValueInput, {
      value: "",
      isBodyweight: false,
      unit: "lb",
      onPick() {},
      ariaLabel: "Set 1 weight in lb",
      ...props,
    } as any),
  );

describe("suggested load lives in the weight cell, not a second box", () => {
  it("an empty next-set cell shows the suggestion faded", () => {
    const html = render({ suggested: 115 });
    expect(html).toContain('data-testid="weight-suggested"');
    expect(html).toContain("115");
    expect(html).toContain('aria-label="Set 1 weight in lb, suggested 115 lb"');
  });
  it("a typed value, bodyweight or no suggestion shows no ghost", () => {
    expect(render({ suggested: 115, value: "120" })).not.toContain("weight-suggested");
    expect(render({ suggested: 115, isBodyweight: true, loadType: "bodyweight" })).not.toContain("weight-suggested");
    expect(render({ suggested: null })).not.toContain("weight-suggested");
  });
  it("Done on a blank draft uses the suggestion; blur on a blank draft never does", () => {
    const src = readFileSync("src/components/workout-day/weight-value-input.tsx", "utf8");
    expect(src).toContain('commitWeight({ load: String(ghost), bodyweight: false, loadType: "external" });');
    expect(src).toContain('if (draft === "") { cancelEditing(); return; }');
  });
  it("the red tap-to-use chip under the set is gone", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).not.toContain("Use suggested ${fmtNum(loadHint.target)}");
  });
});

describe("warm-up fields type like the set cells", () => {
  const base = {
    unit: "lb" as const,
    gridTemplate: "22px 1fr 1fr 1.35fr 44px",
    onFormChange() {},
    onSave() {},
    onRemove() {},
    canEdit: true,
  };
  it("shows the stored values; tapping one makes it the placeholder so typing replaces it", () => {
    const html = renderToStaticMarkup(
      createElement(WarmupRows, { ...base, sets: [{ id: "a", load: 95, unit: "lb", reps: 8, rpe: 6 }], form: "a" } as any),
    );
    expect(html).toContain('value="95"');
    expect(html).toContain('value="8"');
    const src = readFileSync("src/components/workout-day/final-warmup-input.tsx", "utf8");
    expect(src).toContain("before.current = value;");
    expect(src).toContain("onValue(v || before.current);");
  });
  it("keyboard Done closes the keyboard instead of saving before the RPE is picked", () => {
    const src = readFileSync("src/components/workout-day/final-warmup-input.tsx", "utf8");
    expect(src).toContain("(document.activeElement as HTMLElement | null)?.blur();");
  });
});
