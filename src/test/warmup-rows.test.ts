import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { estimateOneRepMax, repsLeftLabel } from "@/lib/final-warmup";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { WarmupRows } = await import("@/components/workout-day/final-warmup-input");

const base = {
  unit: "kg" as const,
  gridTemplate: "34px 1fr 1fr 1.35fr 30px",
  onSave() {},
  onRemove() {},
  canEdit: true,
  columns: { showReps: true, showTimer: false, showCalories: false, showVelocity: false, videoColumn: false },
};
const set = { id: "a", load: 140, unit: "kg" as const, reps: 2, rpe: 7 };
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(WarmupRows, { ...base, sets: [], ...props } as any));

describe("warm-up rows in the set table", () => {
  it("a heavy barbell lift before set 1: one open 'Last warm-up' row with what to work up to", () => {
    const html = render({ style: "last", ramp: true, tunes: true, seed: { load: 125, reps: 2 } });
    expect(html).toContain('data-testid="warmup-open"');
    expect(html).toContain("Last warm-up");
    expect(html).toContain("optional");
    expect(html).toContain("about 125 kg × 2");
    // never a bare "W" to guess at, never a coloured row
    expect(html).not.toContain(">W<");
    expect(html).not.toMatch(/orange-|blue-/);
  });

  it("on a % day (nothing to tune) it's still there before set 1, just without the hint", () => {
    const html = render({ style: "last", ramp: true, tunes: false });
    expect(html).toContain('data-testid="warmup-open"');
    expect(html).toContain("Last warm-up");
    expect(html).not.toContain("about");
  });

  it("an accessory with nothing logged shows nothing (+ Warm-up lives under the sets)", () => {
    expect(render({ style: "secondary", ramp: true, tunes: true })).toBe("");
    // once the working sets start, a heavy lift's open row goes too
    expect(render({ style: "last", ramp: false, tunes: false })).toBe("");
  });

  it("logged warm-ups on an accessory fold into one header line, one tap to open", () => {
    const html = render({ style: "secondary", sets: [set, { ...set, id: "b", load: 100 }] });
    expect(html).toContain("Warm-up");
    expect(html).toContain("2 sets");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-warmup-expanded="false"');
    expect(html).not.toContain('data-testid="warmup-row"');
  });

  it("on a heavy lift before set 1 they stay open, each a row typed into like a set", () => {
    const html = render({ style: "last", ramp: true, tunes: true, sets: [set], read: "tuned" });
    expect(html).toContain('data-warmup-expanded="true"');
    expect(html).toContain('data-testid="warmup-row"');
    expect(html).toContain("Warm-up reps");
    expect(html).toContain("Warm-up RPE (optional)");
    expect(html).toContain("Warm-up weight in kg");
    expect(html).toContain('>140<');
    // its flame opens Remove
    expect(html).toContain("data-warmup-menu");
    expect(html).toContain("Warm-up 140 kg × 2 · RPE 7: options");
  });

  it("the header says what the warm-up did to today's weight", () => {
    expect(render({ style: "last", ramp: true, tunes: true, sets: [set], read: "tuned", suggestOn: true })).toContain("✓ Suggested tuned");
    const off = render({ style: "last", ramp: true, tunes: true, sets: [set], read: "tuned", suggestOn: false, todayLoad: 155, target: { reps: 5, rpe: 8 } });
    expect(off).toMatch(/data-warmup-answer[^>]*>155 kg</);
    expect(off).toContain("tap set 1 to log it");
    expect(render({ style: "last", ramp: true, tunes: true, sets: [set], read: "light" })).toContain("too light to tune today&#x27;s weight");
    expect(render({ style: "last", ramp: true, tunes: true, sets: [set], read: "too_easy" })).toContain("RPE too low for a reliable estimate");
    expect(render({ style: "last", ramp: true, tunes: true, sets: [set], read: "too_easy_cold" })).toContain("your first set sets it");
    // once it can't tune, it only says how many
    const after = render({ style: "last", ramp: false, tunes: false, sets: [set], read: null });
    expect(after).not.toContain("tuned");
    expect(after).toContain("1 set");
  });

  it("read-only: the rows stay, nothing to edit or remove", () => {
    const html = render({ style: "last", ramp: true, tunes: true, sets: [set], canEdit: false });
    expect(html).toContain('data-testid="warmup-row"');
    expect(html).not.toContain("data-warmup-menu");
    expect(html).not.toContain('data-testid="warmup-open"');
  });

  it("sits in the set table above set 1, with + Warm-up opening a new row inside its tap", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    const rows = wdv.indexOf("<WarmupRows");
    expect(rows).toBeGreaterThan(wdv.indexOf("<EffortScaleHeader rir={showRir} />"));
    expect(rows).toBeLessThan(wdv.indexOf("<SetRow\n"));
    expect(wdv).toContain('!hideWeight && rowLoadType === "external" && !readonly && adapter?.kind !== "member" && !!clientId;');
    expect(wdv).toContain("const warmupGauge = warmupPromptable && loadModel && !workedToday ?");
    expect(wdv).toContain("flushSync(() => setWarmupAddToken((t) => t + 1));");
    expect(wdv).toContain("warmupDraftEditRef.current?.();");
    expect(wdv).toContain('style={rampsUp ? warmupStyle : "secondary"}');
    expect(wdv).toContain("ramp={!workedToday}");
  });

  it("only a heavy barbell lift's warm-ups are read for today's weight, and never over double progression", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain('const warmupsRead = warmupEligible && warmupStyle === "last" && !progressionPlan;');
    expect(wdv).toContain("const warmupPromptable = warmupsRead && rampsUp;");
  });

  it("a logged warm-up's weight is what set 1's tap logs, Suggest on or off (never drafts in the boxes)", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).not.toContain("const fillLoadOnOpenSets");
    expect(wdv).toContain("const quickLoad: number | null = quickLoadFromStrip ?? warmupTodayLoad;");
    expect(wdv).toContain("todayLoad={warmupTodayLoad}");
  });
});

describe("which cards get the open Last warm-up row", () => {
  it("heavy barbell compounds: the main lifts and barbell squats, hinges, hip thrusts and presses", async () => {
    const { warmupStyleOf } = await import("@/lib/final-warmup");
    expect(warmupStyleOf("squat", "Competition Squat", "Barbell, Rack")).toBe("last");
    expect(warmupStyleOf("bench", "2ct Paused Bench", "Barbell, Bench, Rack")).toBe("last");
    expect(warmupStyleOf("deadlift", "Competition Deadlift", "Barbell")).toBe("last");
    expect(warmupStyleOf("accessory", "Barbell Hip Thrust", null)).toBe("last");
    expect(warmupStyleOf("accessory", "Overhead Press", "Barbell")).toBe("last");
    expect(warmupStyleOf("accessory", "Trap Bar Deadlift", null)).toBe("last");
  });
  it("everything else keeps warm-ups secondary: dumbbells, machines, cables, rows, isolation", async () => {
    const { warmupStyleOf } = await import("@/lib/final-warmup");
    expect(warmupStyleOf("bench", "Incline Dumbbell Press", "Dumbbells")).toBe("secondary");
    expect(warmupStyleOf("squat", "Leg Press", "Machine")).toBe("secondary");
    expect(warmupStyleOf("accessory", "Barbell Row", "Barbell")).toBe("secondary");
    expect(warmupStyleOf("accessory", "Cable Lateral Raise", "Cable")).toBe("secondary");
    expect(warmupStyleOf("accessory", "Lat Pulldown", "Cable")).toBe("secondary");
    expect(warmupStyleOf("accessory", "EZ Bar Curl", "EZ Bar")).toBe("secondary");
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

describe("e1RM: today's best set feeds Workout Tools", () => {
  it("picks today's best rough 1RM from sets with an RPE", async () => {
    const { bestE1rm } = await import("@/components/workout-day/final-warmup-input");
    const best = bestE1rm([{ load: 140, reps: 5, rpe: 8 }, { load: 145, reps: 5, rpe: 8.5 }, { load: 150, reps: 3, rpe: null }], "kg");
    expect(best?.from.load).toBe(145);
    expect(best?.e1rm).toBe(estimateOneRepMax({ load: 145, reps: 5, rpe: 8.5 }, "kg"));
  });
  it("each compound-lift card reports it (sets and warm-ups); no chip on the card", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("toolsActions?.reportE1rm(row.id, e1rmBest");
    expect(wdv).toContain('!offersLastWarmup(family, name)) return null;');
    expect(wdv).not.toContain("E1rmChip");
  });
});
