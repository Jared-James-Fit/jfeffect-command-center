import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { estimateOneRepMax, repsLeftLabel } from "@/lib/final-warmup";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { WarmupRows } = await import("@/components/workout-day/final-warmup-input");

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
  it("before the first working set: asks for the last warm-up, with what to warm up to", () => {
    const html = render({ prompt: { suggested: { load: 125, reps: 2 }, tunes: true } });
    expect(html).toContain('data-testid="warmup-prompt"');
    expect(html).toContain(">W<");
    expect(html).toContain("~125 × 2");
    expect(html).toContain("Tunes today&#x27;s weight · rough 1RM estimate");
  });

  it("no history yet: says the warm-up is how to get a working weight", () => {
    expect(render({ prompt: { suggested: null, tunes: true } })).toContain("Gets your working weight · rough 1RM estimate");
  });

  it("after working sets it stays, as a rough 1RM check", () => {
    const html = render({ prompt: { suggested: { load: 125, reps: 2 }, tunes: false } });
    expect(html).toContain("Log it for a rough 1RM estimate");
    expect(html).not.toContain("~125 × 2");
  });

  it("logged warm-ups show weight × reps @ RPE and a rough 1RM", () => {
    const html = render({ sets: [set], prompt: { suggested: null, tunes: true }, tunedId: "a" });
    expect(html).not.toContain("warmup-prompt");
    expect(html).toContain("140 kg × 2");
    expect(html).toContain("@ 7");
    expect(html).toContain("≈1RM 162.5");
    expect(html).toContain("✓ tuned");
  });

  it("read-only rows stay, without editing or a prompt", () => {
    const html = render({ sets: [set], canEdit: false, prompt: { suggested: null, tunes: false } });
    expect(html).toContain("140 kg × 2");
    expect(html).not.toContain("Edit warm-up");
    expect(render({ canEdit: false, prompt: { suggested: null, tunes: false } })).not.toContain("warmup-prompt");
  });

  it("the add form shows the suggested warm-up faded, and RPE is typed (any value)", () => {
    const html = render({ form: "new", seed: { load: 125, reps: 2 }, prompt: { suggested: { load: 125, reps: 2 }, tunes: true } });
    expect(html).toContain("Add warm-up");
    expect(html).toContain('placeholder="125"');
    expect(html).toContain('placeholder="2"');
    expect(html).toContain('aria-label="Warm-up RPE"');
    expect(html).toContain("not a tested max");
    expect(html).toContain("Not counted in volume, records or points");
    expect(html).not.toContain("warmup-prompt");
  });

  it("editing opens in place of the row, with the stored RPE and the live 1RM read", () => {
    const html = render({ sets: [set], form: "a" });
    expect(html).toContain("Save warm-up");
    expect(html).toContain(">Remove<");
    expect(html).toContain('value="7"');
    expect(html).toContain("RPE 7 · about 3 reps left");
    expect(html).toContain("≈ 1RM 162.5 kg");
    expect(html).not.toContain('data-testid="warmup-row"');
  });

  it("sits in the set table above Set 1, and stays available after working sets", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const rows = wdv.indexOf("<WarmupRows");
    expect(rows).toBeGreaterThan(wdv.indexOf("<EffortScaleHeader rir={showRir} />"));
    expect(rows).toBeLessThan(wdv.indexOf("<SetRow\n"));
    expect(wdv).toContain('!hideWeight && rowLoadType === "external" && !readonly && adapter?.kind !== "member" && !!clientId;');
    expect(wdv).toContain("const warmupGauge = warmupPromptable && loadModel && !workedToday ?");
  });
});

describe("rough 1RM from one set", () => {
  it("uses the same RPE chart as the load suggestions, rounded to plates", () => {
    expect(estimateOneRepMax({ load: 140, reps: 2, rpe: 7 }, "kg")).toBe(162.5);
    expect(estimateOneRepMax({ load: 315, reps: 3, rpe: 8 }, "lb")).toBe(365);
    expect(estimateOneRepMax({ load: 405, reps: 1, rpe: 10 }, "lb")).toBe(405);
  });
  it("won't guess from sets that can't support it", () => {
    expect(estimateOneRepMax({ load: 105, reps: 2, rpe: 4 }, "lb")).toBeNull(); // too easy
    expect(estimateOneRepMax({ load: 105, reps: 2, rpe: null }, "lb")).toBeNull(); // no RPE
    expect(estimateOneRepMax({ load: 105, reps: 12, rpe: 8 }, "lb")).toBeNull(); // too many reps
  });
  it("explains RPE as reps left", () => {
    expect(repsLeftLabel(8)).toBe("about 2 reps left");
    expect(repsLeftLabel(9)).toBe("about 1 rep left");
    expect(repsLeftLabel(7.5)).toBe("2–3 reps left");
    expect(repsLeftLabel(10)).toBe("nothing left");
    expect(repsLeftLabel(4)).toBe("5+ reps left");
  });
});

describe("reset is always in the workout menu", () => {
  it("doesn't hide on a 0% workout (drafts and warm-ups aren't 'activity')", () => {
    const src = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
    expect(src).toContain("const canReset = canChangeWorkoutStatus;");
  });
});
