import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withoutFixedLoads, withLoadingGuard, loadingRefsFrom } from "@/lib/program-intel/loading";
import { athleteNotes } from "@/lib/program-intel/program-view";

// The notes the Nov 2 2026 run wrote into four live programs.
describe("withoutFixedLoads: a note never carries a weight to lift", () => {
  it.each([
    ["Station 1: Barbell. Start ~430lb. Focus on slack pull and wedge.", "Station 1: Barbell. Focus on slack pull and wedge."],
    ["Station 1: Rack. Start with 145lb (last block's top set). Focus on depth and bracing.", "Station 1: Rack. Focus on depth and bracing."],
    ["Station 1. Start with 165lb (last block top set). Focus on bracing to protect low back.", "Station 1. Focus on bracing to protect low back."],
    ["Double progression. Start at 20lb.", "Double progression."],
    ["Station 2. Use 50lb DBs. Rest 90s after both legs are done.", "Station 2. Rest 90s after both legs are done."],
    ["Station 2. Superset with the split squats. Use 45lb DB.", "Station 2. Superset with the split squats."],
    ["Start with 35lb DBs. Focus on deep stretch.", "Focus on deep stretch."],
    ["Watch neck pain; ensure head is supported. Start ~85lb.", "Watch neck pain; ensure head is supported."],
    ["Monitor right ankle. If tight, use a small heel elevation. Start with 140lb.", "Monitor right ankle. If tight, use a small heel elevation."],
    ["Start with 110lb and keep elbows tucked.", "Keep elbows tucked."],
    ["Station 3: Bench Attachment. Drop bench to flat. Start with 30lb.", "Station 3: Bench Attachment. Drop bench to flat."],
    ["start at 60 kg.", null],
  ])("%s", (note, want) => {
    expect(withoutFixedLoads(note)).toBe(want);
  });

  it.each([
    "Add 5-10lb weekly if RPE ≤ target.",
    "Add 2.5-5lb when all sets hit 8 reps.",
    "When all sets reach 10 reps at RPE ≤8, add 2.5 kg",
    "start ~5 kg under last block's top set",
    "Deload: -10% load.",
    "Use the safety bar if the shoulder is sore.",
    "Pick a weight you could lift 3 more times.",
  ])("keeps steps and relative cues: %s", (note) => {
    expect(withoutFixedLoads(note)).toBe(note);
  });
});

describe("Generate Next Program keeps fixed weights out of what the athlete reads", () => {
  const ex = {
    exercise_id: "dl", exercise_name: "Competition Deadlift", role: "Primary Deadlift", station: null, superset: null,
    sets: 2, reps: "5", rpe: "7", rir: null, percentage: null, percentage_of: null, rest_seconds: 180, tempo: null,
    progression: "Add 5-10lb weekly if RPE ≤ target. Start at 400lb.", substitutions: [{ exercise_id: null, exercise_name: "Conventional Deadlift" }],
    notes: "Station 1: Barbell. Start ~430lb. Focus on slack pull and wedge.",
    weeks: [{ week: 2, rpe: "8", notes: "Start with 440lb. Same setup." }],
  } as any;

  it("the rows written read the cue, the step and the swap, never the weight", () => {
    expect(athleteNotes(ex, 1)).toBe("Station 1: Barbell. Focus on slack pull and wedge. · Progress: Add 5-10lb weekly if RPE ≤ target. · Swap if needed: Conventional Deadlift");
    expect(athleteNotes(ex, 2)).toBe("Same setup. · Progress: Add 5-10lb weekly if RPE ≤ target. · Swap if needed: Conventional Deadlift");
  });

  it("the loading guard cleans the block (draft view, review) and says so", () => {
    const block = { name: "B1", objective: "", weeks: 2, week_phases: [], deload_rule: null, progression_rules: [], days: [{ day: 1, title: "Day 1", focus: "", exercises: [ex] }] } as any;
    const refs = loadingRefsFrom([], []);
    const { block: out, changed } = withLoadingGuard(block, refs, () => "deadlift");
    const e = out.days[0].exercises[0];
    expect(e.notes).toBe("Station 1: Barbell. Focus on slack pull and wedge.");
    expect(e.progression).toBe("Add 5-10lb weekly if RPE ≤ target.");
    expect(e.weeks[0].notes).toBe("Same setup.");
    expect(changed.some((c) => c.includes("Competition Deadlift") && c.includes("weight in its note"))).toBe(true);
  });

  it("the prompts say it: no weight in notes, relative cues only", () => {
    const gen = readFileSync("src/lib/program-intel/generator-prompts.ts", "utf8");
    expect(gen).toContain("never write a weight to lift in \"notes\" or \"progression\"");
    expect(gen).not.toContain("start ~5 kg under last block's top set\"), never as invented past results");
    expect(readFileSync("src/lib/program-ai/prompts.ts", "utf8")).toContain("never a weight inside \"notes\"");
  });
});
