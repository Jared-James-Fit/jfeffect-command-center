import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { WarmupRows, WARMUP_RPE_SCALE, warmupRpeStep } = await import("@/components/workout-day/final-warmup-input");

const base = {
  unit: "kg" as const,
  gridTemplate: "22px 1fr 1fr 1.35fr 44px",
  form: null,
  onFormChange() {},
  onSave() {},
  onRemove() {},
  canEdit: true,
};
const set = { id: "a", load: 140, unit: "kg" as const, reps: 2, rpe: 7 };
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(WarmupRows, { ...base, sets: [], ...props } as any));

describe("warm-up rows in the set table", () => {
  it("asks for the last warm-up as a W row, with what to warm up to when known", () => {
    const html = render({ prompt: { suggested: { load: 125, reps: 2 } } });
    expect(html).toContain('data-testid="warmup-prompt"');
    expect(html).toContain(">W<");
    expect(html).toContain("~125 × 2");
    expect(html).toContain("Log how it felt to fine-tune your weight");
  });

  it("no history yet: says the warm-up is how to get a working weight", () => {
    const html = render({ prompt: { suggested: null } });
    expect(html).toContain("Log it to get your working weight");
  });

  it("logged warm-ups replace the prompt and show weight × reps and how it felt", () => {
    const html = render({ sets: [set], prompt: { suggested: null }, tunedId: "a" });
    expect(html).not.toContain("warmup-prompt");
    expect(html).toContain("140 kg × 2");
    expect(html).toContain("@ RPE 7");
    expect(html).toContain("✓ set your weight");
    expect(html).toContain('aria-label="Edit warm-up 140 kg × 2 · RPE 7"');
  });

  it("read-only once working sets are logged: rows stay, no prompt, no editing", () => {
    const html = render({ sets: [set], canEdit: false, prompt: { suggested: null } });
    expect(html).toContain("140 kg × 2");
    expect(html).not.toContain("Edit warm-up");
    expect(render({ canEdit: false, prompt: { suggested: null } })).not.toContain("warmup-prompt");
  });

  it("the add form opens in the table, pre-filled with the suggested warm-up", () => {
    const html = render({ form: "new", seed: { load: 125, reps: 2 }, prompt: { suggested: { load: 125, reps: 2 } } });
    expect(html).toContain("Add warm-up");
    expect(html).toContain('value="125"');
    expect(html).toContain("Not counted in volume, records or points");
    expect(html).not.toContain("warmup-prompt");
  });

  it("editing opens in place of the row, with Remove inside the form", () => {
    const html = render({ sets: [set], form: "a" });
    expect(html).toContain("Save warm-up");
    expect(html).toContain(">Remove<");
    expect(html).not.toContain('data-testid="warmup-row"');
  });

  it("sits in the set table above Set 1, not as a hint above the card's buttons", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const rows = wdv.indexOf("<WarmupRows");
    expect(rows).toBeGreaterThan(wdv.indexOf("<EffortScaleHeader rir={showRir} />"));
    expect(rows).toBeLessThan(wdv.indexOf("<SetRow\n"));
    expect(wdv).not.toContain("WarmupSection");
  });
});

describe("warm-up RPE scale", () => {
  it("covers easy through grindy on the set table's RPE scale, whole numbers only", () => {
    expect(WARMUP_RPE_SCALE.map((x) => x.label)).toEqual(["≤6", "7", "8", "9+"]);
    expect(WARMUP_RPE_SCALE.map((x) => x.rpe)).toEqual([6, 7, 8, 9]);
    expect(WARMUP_RPE_SCALE.map((x) => x.left)).toEqual(["4+ left", "3 left", "2 left", "1 left"]);
  });
  it("super easy counts as ≤6 and anything past 9 as 9+ (matches the engine's floor)", () => {
    expect(warmupRpeStep(4)?.label).toBe("≤6");
    expect(warmupRpeStep(6)?.label).toBe("≤6");
    expect(warmupRpeStep(7.5)?.label).toBe("8");
    expect(warmupRpeStep(10)?.label).toBe("9+");
    expect(warmupRpeStep(null)).toBeNull();
    const engine = readFileSync("src/lib/load-suggestion.ts", "utf8");
    expect(engine).toContain("export const WARMUP_RPE_FLOOR = 6;");
  });
  it("explains the pick in one line, and prompts by reps left before a pick", () => {
    const blank = renderToStaticMarkup(createElement(WarmupRows, { ...base, sets: [], form: "new" } as any));
    expect(blank).toContain("Rate it by reps you had left in the tank");
    expect(blank).toContain('aria-label="RPE 9+, 1 left"');
    const editing = renderToStaticMarkup(createElement(WarmupRows, { ...base, sets: [{ ...set, rpe: 9 }], form: "a" } as any));
    expect(editing).toContain("Grindy — 1 rep left at most");
    expect(editing).toContain('aria-pressed="true"');
  });
});
