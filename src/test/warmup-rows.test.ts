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

const preview = (w: { load: number; reps: number; rpe: number | null }) =>
  ({ low: Math.round(w.load * 1.5), high: Math.round(w.load * 1.6), target: Math.round(w.load * 1.55), unit: "kg" as const });
const tuneProps = { target: { reps: 7, rpe: 4 }, preview, openSets: 3, onUseForAllSets: async () => 3 };

describe("warm-up rows in the set table", () => {
  it("before the first working set: 'Last warm-up → today's weight', with what to work up to", () => {
    const html = render({ prompt: { suggested: { load: 125, reps: 2 }, tunes: true } });
    expect(html).toContain('data-testid="warmup-prompt"');
    expect(html).toContain(">W<");
    expect(html).toContain("Last warm-up → today&#x27;s weight");
    expect(html).toContain("Work up to ~125 × 2, log it, get your sets");
  });

  it("no history yet: says the warm-up is how to get a working weight", () => {
    expect(render({ prompt: { suggested: null, tunes: true } })).toContain("Log it to get your working weight");
  });

  it("after working sets it stays, as the e1RM calculator", () => {
    const html = render({ prompt: { suggested: { load: 125, reps: 2 }, tunes: false } });
    expect(html).toContain("e1RM calculator");
    expect(html).toContain("Any set · weight × reps @ RPE → rough 1RM");
    expect(html).toContain(">Open<");
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

  it("'Set today's weight' mode: suggested warm-up faded, says it suggests today's sets, one tap for all sets", () => {
    const html = render({ form: "new", seed: { load: 100, reps: 2 }, prompt: { suggested: { load: 100, reps: 2 }, tunes: true }, ...tuneProps });
    expect(html).toContain("Last warm-up / e1RM");
    expect(html).toContain("Set today&#x27;s weight");
    expect(html).toContain("e1RM only");
    expect(html).toContain("we&#x27;ll suggest your 7 reps @ RPE 4");
    expect(html).toContain('placeholder="100"');
    expect(html).toContain("Today: 7 @ RPE 4");
    expect(html).toContain("150–160 kg");
    expect(html).toContain("Use 155 kg for all 3 sets");
    expect(html).toContain("Just log the warm-up");
    expect(html).toContain("not a tested max");
  });

  it("no target (after working sets / coach load): just the calculator — nothing saved", () => {
    const html = render({ form: "new", prompt: { suggested: null, tunes: false } });
    expect(html).not.toContain("Set today&#x27;s weight");
    expect(html).toContain("Nothing is saved or changed");
    expect(html).toContain(">Done<");
    expect(html).not.toContain("warmup-use-all");
  });

  it("editing opens in place of the row, with the stored RPE and the live e1RM", () => {
    const html = render({ sets: [set], form: "a" });
    expect(html).toContain("Save warm-up");
    expect(html).toContain(">Remove<");
    expect(html).toContain('value="7"');
    expect(html).toContain("RPE 7 · about 3 reps left");
    expect(html).toContain("≈ 162.5 kg");
    expect(html).not.toContain('data-testid="warmup-row"');
  });

  it("sits in the set table above Set 1, stays after working sets, and previews with the real engine", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const rows = wdv.indexOf("<WarmupRows");
    expect(rows).toBeGreaterThan(wdv.indexOf("<EffortScaleHeader rir={showRir} />"));
    expect(rows).toBeLessThan(wdv.indexOf("<SetRow\n"));
    expect(wdv).toContain('!hideWeight && rowLoadType === "external" && !readonly && adapter?.kind !== "member" && !!clientId;');
    expect(wdv).toContain("const warmupGauge = warmupPromptable && loadModel && !workedToday ?");
    expect(wdv).toContain("const model = buildLoadModel({ history: loadHistory, today: [], unit: activeUnit, readiness, warmup: w, bodyweightKg });");
  });

  it("'use for all sets' fills only open sets with the weight, keeping each set's reps / RPE, as drafts", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const fill = wdv.slice(wdv.indexOf("const fillLoadOnOpenSets"), wdv.indexOf("// \"Apply to remaining\""));
    expect(fill).toContain("if (ex?.completed_at) continue;");
    expect(fill).toContain("actual_reps: ex?.actual_reps ?? null,");
    expect(fill).toContain("completed_at: null,");
    expect(wdv).toContain("(setIndex !== 1 || forcedFill.includeFirst)");
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
