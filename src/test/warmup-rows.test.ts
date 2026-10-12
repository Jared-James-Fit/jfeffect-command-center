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
  it("before the first working set: one slim 'Last warm-up' row with what to work up to", () => {
    const html = render({ prompt: { suggested: { load: 125, reps: 2 }, tunes: true } });
    expect(html).toContain('data-testid="warmup-prompt"');
    expect(html).toContain(">W<");
    expect(html).toContain("Last warm-up");
    expect(html).toContain("~125 × 2");
    expect(html).toContain(">Log<");
    expect(render({ prompt: { suggested: null, tunes: true } })).toContain("sets today&#x27;s weight");
  });

  it("once it can't tune, the warm-up prompt goes (e1RM has its own chip)", () => {
    expect(render({ prompt: { suggested: null, tunes: false } })).not.toContain("warmup-prompt");
    expect(render({ prompt: { suggested: null, tunes: false } })).not.toContain("e1RM");
  });

  it("logged warm-ups stay as compact W rows: weight × reps, how it felt, tuned", () => {
    const html = render({ sets: [set], tunedId: "a" });
    expect(html).not.toContain("warmup-prompt");
    expect(html).toContain("140 kg × 2");
    expect(html).toContain("Smooth 7");
    expect(html).toContain("✓ tuned");
    expect(html).not.toContain("1RM");
  });

  it("read-only: rows stay, no edit, no prompt", () => {
    const html = render({ sets: [set], canEdit: false });
    expect(html).toContain("140 kg × 2");
    expect(html).not.toContain("Edit warm-up");
    expect(render({ canEdit: false, prompt: { suggested: null, tunes: true } })).not.toContain("warmup-prompt");
  });

  it("open: suggested warm-up pre-filled, four feel taps (Smooth by default), the answer and one Use button", () => {
    const html = render({ form: "new", seed: { load: 100, reps: 2 }, prompt: { suggested: { load: 100, reps: 2 }, tunes: true }, ...tuneProps });
    expect(html).toContain('value="100"');
    expect(html).toContain('value="2"');
    for (const f of ["Easy", "Smooth", "Heavy", "Grind"]) expect(html).toContain(f);
    expect(html).toMatch(/aria-checked="true"[^>]*>Smooth/);
    expect(html).toContain("Today: 7 reps @ RPE 4");
    expect(html).toMatch(/data-testid="warmup-target"[^>]*>155 kg</);
    expect(html).toContain("(150–160)");
    expect(html).toContain("Use for 3 sets");
    expect(html).toContain("Log warm-up only");
    // no mode tabs, no typed RPE, no e1RM in here
    expect(html).not.toContain("e1RM");
    expect(html).not.toContain('name="warmup-rpe"');
  });

  it("no target (after working sets / coach load): just log it", () => {
    const html = render({ form: "new", prompt: { suggested: null, tunes: false } });
    expect(html).toContain("Save warm-up");
    expect(html).not.toContain("warmup-use-all");
  });

  it("editing opens in place of the row, with how it felt and Remove", () => {
    const html = render({ sets: [set], form: "a" });
    expect(html).toContain(">Remove<");
    expect(html).toContain('value="140"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Smooth/);
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

describe("the warm-up answer adds up", () => {
  it("a single open set reads 'Use'", () => {
    const html = render({ form: "new", seed: { load: 100, reps: 2 }, prompt: { suggested: null, tunes: true }, ...tuneProps, openSets: 1 });
    expect(html).toMatch(/data-testid="warmup-target"[^>]*>155 kg</);
    expect(html).toContain(">Use<");
    expect(html).not.toContain("for 1 set");
  });

  it("the set row's ghost hides while the warm-up form is setting the weight", () => {
    const view = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(view).toContain("loadHint={warmupForm && warmupGauge ? null : loadHint}");
  });
});

describe("e1RM: its own compact chip", () => {
  it("shows today's best rough 1RM from sets with an RPE, else just 'e1RM'", async () => {
    const { bestE1rm } = await import("@/components/workout-day/final-warmup-input");
    const { E1rmChip } = await import("@/components/workout-day/card-tools");
    const best = bestE1rm([{ load: 140, reps: 5, rpe: 8 }, { load: 145, reps: 5, rpe: 8.5 }, { load: 150, reps: 3, rpe: null }], "kg");
    expect(best?.from.load).toBe(145);
    expect(best?.e1rm).toBe(estimateOneRepMax({ load: 145, reps: 5, rpe: 8.5 }, "kg"));
    const html = renderToStaticMarkup(createElement(E1rmChip, { sets: [{ load: 145, reps: 5, rpe: 8.5 }], unit: "kg", open: false, onToggle() {} }));
    expect(html).toContain('data-testid="e1rm-chip"');
    expect(html).toContain(`≈${best!.e1rm}`);
    expect(renderToStaticMarkup(createElement(E1rmChip, { sets: [], unit: "kg", open: false, onToggle() {} }))).toMatch(/e1RM<\/button>/);
  });
  it("sits in the card header on compound lifts, fed by today's sets and warm-ups", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain('{e1rmSets && <E1rmChip sets={e1rmSets} unit={activeUnit} open={cardTool === "e1rm"} onToggle={() => toggleCardTool("e1rm")} />}');
    expect(wdv).toContain('!offersLastWarmup(family, name)) return null;');
  });
});
