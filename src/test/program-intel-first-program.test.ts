import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildBrief } from "@/lib/program-intel/brief";
import { experienceLevel, goalBrain, setupNotes, startingDose } from "@/lib/program-intel/first-program";
import { constructSystemPrompt, FIRST_PROGRAM_RULES, PIPELINE_PROMPT_VERSION, strategySystemPrompt, strategyUserPrompt } from "@/lib/program-intel/generator-prompts";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import { findConflicts, redistribution } from "@/lib/program-intel/recommend";
import type { IntelRecords, RawGoals } from "@/lib/program-intel/types";
import { buildRecords, HOME_EXERCISES, homeGym } from "./program-intel-scenarios";

// A client who just joined: no programs, no logged sets, only what they told you at setup.
const COMMERCIAL_GYM = ["Barbell", "Squat rack", "Bench", "Dumbbells", "Machines", "Cable station", "Leg press", "Leg extension", "Leg curl", "Lat pulldown", "Seated row"];
const goals = (over: Partial<RawGoals>): RawGoals =>
  ({
    main_goal: "Build muscle",
    main_goal_other: null,
    goal_target: null,
    training_days_per_week: 3,
    workout_length_minutes: 60,
    training_experience: "Beginner",
    training_styles: ["Coach can decide"],
    training_location: "Commercial gym",
    equipment: COMMERCIAL_GYM,
    injuries_has: false,
    injuries_details: null,
    final_notes: null,
    available_weekdays: ["mon", "wed", "fri"],
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  }) as RawGoals;
const newClient = (g: Partial<RawGoals> | null, over: Partial<IntelRecords> = {}, days = ["Monday", "Wednesday", "Friday"]): IntelRecords => {
  const rec = buildRecords({ exercises: HOME_EXERCISES, blocks: [], over: { goals: g ? goals(g) : null, bodyweight: [{ date: "2026-11-01", kg: 72 }], ...over } });
  rec.client = { ...rec.client, committed_training_days: days, committed_training_frequency: days.length } as any;
  return rec;
};
const conflictsOf = (rec: IntelRecords) => {
  const intel = buildGeneratorIntel(rec);
  return { intel, conflicts: findConflicts(intel.recommendation.setup, intel.ctx, intel.recommendation.baseline, () => null) };
};

describe("setup answers, read for a first program", () => {
  it("experience: under a year is a beginner, 1–5 years intermediate, more than 5 advanced", () => {
    expect(experienceLevel("Beginner")).toBe("beginner");
    expect(experienceLevel("Less than 1 year")).toBe("beginner");
    expect(experienceLevel("1–3 years")).toBe("intermediate");
    expect(experienceLevel("3–5 years")).toBe("intermediate");
    expect(experienceLevel("More than 5 years")).toBe("advanced");
    expect(experienceLevel("intermediate")).toBe("intermediate");
    expect(experienceLevel(null)).toBeNull();
    expect(experienceLevel("")).toBeNull();
  });

  it("the setup's last answer counts when it says something; 'No', 'Na', 'nope' don't", () => {
    for (const nothing of ["No", "Na", "nope", "No other concerns.", "None", "n/a", " "]) expect(setupNotes(nothing)).toBeNull();
    expect(setupNotes("I have PCOS, so I am on medication")).toBe("I have PCOS, so I am on medication");
  });

  it("the goal they picked sets the framework, the styles settle what it leaves open", () => {
    expect(goalBrain({ main: "Build muscle" }, "beginner")?.brain).toBe("bodybuilding");
    expect(goalBrain({ main: "Build glutes" }, null)?.brain).toBe("bodybuilding");
    expect(goalBrain({ main: "Build muscle", styles: ["Strength"] }, "intermediate")?.brain).toBe("powerbuilding");
    expect(goalBrain({ main: "Build muscle", styles: ["Strength"] }, "beginner")?.brain).toBe("bodybuilding");
    expect(goalBrain({ main: "Get stronger" }, "beginner")?.brain).toBe("general_strength");
    expect(goalBrain({ main: "Powerlifting" }, null)?.brain).toBe("powerlifting");
    expect(goalBrain({ main: "Prepare for a competition", styles: ["Powerlifting"] }, "advanced")?.brain).toBe("powerlifting");
    expect(goalBrain({ main: "Prepare for a competition", styles: ["Bodybuilding"] }, "advanced")?.brain).toBe("bodybuilding");
    expect(goalBrain({ main: "Lose body fat", styles: ["General fitness", "Coach can decide"] }, "beginner")?.brain).toBe("general_fitness");
    // the real client waiting for a first program: fat loss after 3–5 years of strength and bodybuilding training
    expect(goalBrain({ main: "Lose body fat", styles: ["General fitness", "Strength", "Bodybuilding"] }, "intermediate")?.brain).toBe("powerbuilding");
    expect(goalBrain({ main: "Other", styles: ["Bodybuilding"] }, null)?.brain).toBe("bodybuilding");
    expect(goalBrain({ main: "Other", styles: ["Coach can decide"] }, null)).toBeNull();
  });
});

describe("a brand-new client: the recommended first program", () => {
  it("'Build muscle' reads as bodybuilding (it used to fall to general fitness), 4 weeks, with a starting dose", () => {
    const { intel, conflicts } = conflictsOf(newClient({ goal_target: "Bigger chest and arms" }));
    const s = intel.recommendation.setup;
    const why = intel.recommendation.why;
    expect(intel.firstProgram).toBe(true);
    expect(intel.brain).toBe("bodybuilding");
    expect(intel.classification.reasons[0]).toBe('No training on file yet: their goal is "Build muscle"');
    expect(s.weeks).toBe(4);
    expect(why.weeks?.source).toBe("First program");
    expect(s.priorities).toEqual(["Biceps", "Triceps", "Chest"]);
    const vol = Object.fromEntries(s.volume.map((v) => [v.target, v.setsPerWeek]));
    expect(vol).toMatchObject({ Chest: 10, Quads: 8, Hamstrings: 8, Glutes: 8, Back: 6, Lats: 6, Shoulders: 6, Biceps: 8, Triceps: 8, Calves: 6 });
    expect(s.frequency.find((f) => f.target === "Chest")?.perWeek).toBe(2);
    expect(s.frequency.find((f) => f.target === "Calves")?.perWeek).toBe(1);
    expect(s.intensity).toBe("Compounds 8–12 reps, isolation 10–15 · no percentages: no maxes or logged loads on file yet");
    expect(s.effort).toMatch(/^Week 1 at RPE 6–7/);
    expect(s.progression).toMatch(/^Double progression/);
    expect(why.volume?.reason).toMatch(/A starting dose for a beginner \(Goals & Setup: "Beginner"\).*Fits 3 × 60-min sessions/);
    expect(s.retain).toEqual([]);
    expect(why.retain?.source).toBe("First program");
    expect(conflicts).toEqual([]);
  });

  it("an experienced lifter who wants to lose fat keeps strength and muscle work, with more volume", () => {
    const { intel } = conflictsOf(newClient({ main_goal: "Lose body fat", training_experience: "3–5 years", training_styles: ["General fitness", "Strength", "Bodybuilding"], training_days_per_week: 4, workout_length_minutes: 75 }, {}, ["Monday", "Tuesday", "Thursday", "Friday"]));
    const s = intel.recommendation.setup;
    expect(intel.brain).toBe("powerbuilding");
    expect(s.volume.find((v) => v.target === "Chest")?.setsPerWeek).toBe(10);
    expect(s.volume.find((v) => v.target === "Squat")?.setsPerWeek).toBe(7);
    expect(s.frequency.find((f) => f.target === "Deadlift")?.perWeek).toBe(1);
    expect(s.intensity).toMatch(/^Main lifts 4–6 reps \(top set \+ back-offs\)/);
    expect(s.effort).toMatch(/^Week 1 at RPE 7 to set the loads/);
  });

  it("a week that wouldn't fit their minutes is scaled down, and it says so", () => {
    const { intel } = conflictsOf(newClient({ workout_length_minutes: 30, training_experience: "3–5 years" }));
    const s = intel.recommendation.setup;
    expect(intel.recommendation.why.volume?.reason).toMatch(/Scaled to \d+% to fit 3 × 30-min sessions/);
    expect(s.volume.find((v) => v.target === "Chest")!.setsPerWeek).toBeLessThan(12);
    expect(s.volume.every((v) => v.setsPerWeek >= 3)).toBe(true);
  });

  it("a powerlifter with a max entered at setup: lift doses and percentages only for that lift", () => {
    const rec = newClient({ main_goal: "Powerlifting", training_experience: "More than 5 years", training_styles: ["Powerlifting"], workout_length_minutes: 90 }, {
      maxes: [{ lift: "squat", exercise_id: null, one_rm: 180, training_max: null, estimated_1rm: null, unit: "kg", tested_at: "2026-10-01", source: "intake", active: true }],
    }, ["Monday", "Tuesday", "Thursday", "Saturday"]);
    const intel = buildGeneratorIntel(rec);
    const s = intel.recommendation.setup;
    expect(intel.brain).toBe("powerlifting");
    expect(Object.fromEntries(s.volume.map((v) => [v.target, v.setsPerWeek]))).toEqual({ Squat: 12, Bench: 14, Deadlift: 6 });
    expect(s.frequency.find((f) => f.target === "Bench")?.perWeek).toBe(3);
    expect(s.frequency.find((f) => f.target === "Deadlift")?.perWeek).toBe(2);
    expect(s.intensity).toMatch(/percentages only for a lift with a max on file$/);
    const brief = buildBrief(intel, { setup: s, edited: [], conflicts: [], redistribution: null });
    expect(brief.text).toMatch(/Maxes on file: squat (396|397)lb/);
  });

  it("missing setup answers are named before generating", () => {
    expect(conflictsOf(newClient(null)).conflicts.map((c) => c.id)).toContain("first-no-setup");
    expect(conflictsOf(newClient({ training_experience: null })).conflicts.map((c) => c.id)).toEqual(["first-no-experience"]);
    const noEquipment = conflictsOf(newClient({ equipment: [], training_location: null }));
    expect(noEquipment.conflicts.map((c) => c.id)).toContain("first-no-equipment");
    // a warning, never a blocker: a coach can still build from defaults and their notes
    expect(conflictsOf(newClient(null)).conflicts.every((c) => c.severity === "warning")).toBe(true);
  });

  it("an athlete with training on file is read from it exactly as before", () => {
    const intel = buildGeneratorIntel(homeGym());
    expect(intel.firstProgram).toBe(false);
    expect(intel.recommendation.why.volume?.source).toBe("Last program");
    expect(intel.recommendation.why.weeks?.source).not.toBe("First program");
  });
});

describe("what the AI is told for a first program", () => {
  const rec = newClient({ final_notes: "I want to look more jacked", injuries_has: true, injuries_details: "Sore left shoulder overhead" });
  const intel = buildGeneratorIntel(rec);
  const setup = { ...intel.recommendation.setup, coachNotes: "Upper / lower split\nNo barbell back squat yet" };
  const brief = buildBrief(intel, { setup, edited: ["coachNotes"], conflicts: [], redistribution: redistribution(setup, intel.recommendation.baseline) }).text;

  it("the brief: their setup answers, what isn't known yet, and the coach's notes as direction", () => {
    expect(brief).toContain('Anything else they told you at setup: "I want to look more jacked"');
    expect(brief).toContain("experience: Beginner (beginner)");
    expect(brief).toContain("## First program setup (approved by the coach)");
    expect(brief).toContain("FIRST PROGRAM: no training logged yet");
    expect(brief).toContain("Maxes on file: none (no percentages; never write a starting weight).");
    expect(brief).toContain("Coach's notes & ideas for this program (the head coach's direction: follow each one and say how in coach_requirements): Upper / lower split\nNo barbell back squat yet");
    const later = buildBrief(buildGeneratorIntel(homeGym()), { setup: buildGeneratorIntel(homeGym()).recommendation.setup, edited: [], conflicts: [], redistribution: null }).text;
    expect(later).toContain("## Next program setup (approved by the coach)");
    expect(later).not.toContain("FIRST PROGRAM");
  });

  it("the prompts: first-program rules only for a first program; the coach's notes are followed either way", () => {
    expect(PIPELINE_PROMPT_VERSION).toBe(8);
    const first = strategySystemPrompt("bodybuilding", { first: true });
    expect(first).toContain(FIRST_PROGRAM_RULES);
    expect(first).toContain('"previous_program" is { "intent": "None: first program", "outcome": "None" }');
    expect(strategySystemPrompt("bodybuilding")).not.toContain("FIRST PROGRAM");
    expect(strategyUserPrompt(brief, setup, { first: true })).toMatch(/^Write the programming strategy for their first 4-week, 3-day program/);
    const build = constructSystemPrompt("bodybuilding", { first: true });
    expect(build).toContain("Never write a starting weight: nothing is logged.");
    expect(build).toContain("Week 1 doubles as an assessment");
    for (const p of [first, strategySystemPrompt("powerlifting"), build, constructSystemPrompt("general_fitness")]) expect(p).toContain("The coach's notes & ideas for this program are the head coach's direction");
    expect(build).toContain('then library exercises marked "demo video"');
  });

  it("the worker passes the flag, the maxes as load references, and which library exercises have a demo", () => {
    const pipeline = readFileSync("src/lib/program-intel/pipeline.server.ts", "utf8");
    expect(pipeline).toContain("first_program: intel.firstProgram,");
    expect(pipeline).toContain("strategySystemPrompt(brain, { first: !!ctxRow.first_program })");
    expect(pipeline.match(/constructSystemPrompt\(brain, \{ first: !!ctxRow.first_program \}\)/g)).toHaveLength(2);
    expect(pipeline).toContain("loadReferences(intel.prev ?? (intel.history.lifts.some((l) => l.maxOnFileKg != null) ? intel.history : null))");
    expect(pipeline).toContain('history: e.video_url ? "demo video" : null');
  });
});

describe("the screens", () => {
  it("notes & ideas are their own card, always in view, never also inside the folded controls", () => {
    const setupUi = readFileSync("src/components/program-intel/generator/setup.tsx", "utf8");
    expect(setupUi).toContain("export function ProgramNotesCard(");
    expect(setupUi).toContain("Notes & ideas for this program");
    expect(setupUi).not.toContain("Coach notes for this program");
    expect(setupUi).toContain('testId="gen-row-starting-point"');
    const ws = readFileSync("src/components/program-intel/generator/workstation.tsx", "utf8");
    expect(ws).toContain('<ProgramNotesCard intel={intel} value={setup.coachNotes} edited={edited.has("coachNotes")} onChange={(v) => change("coachNotes", v)} />');
    expect(ws).toContain('title={intel?.firstProgram ? "First program" : "Next program"}');
  });

  it("a client with no program gets 'Write it with AI' on the Training tab, and the Intelligence button says first program", () => {
    const tab = readFileSync("src/components/clients/client-training-tab.tsx", "utf8");
    expect(tab).toContain('data-testid="training-write-with-ai"');
    expect(tab).toContain('title="Write it with AI"');
    expect(readFileSync("src/components/program-intel/ProgramIntelligencePage.tsx", "utf8")).toContain('c.loggedSets === 0 ? "Generate first program" : "Generate next program"');
    expect(readFileSync("src/components/program-intel/generator/overview.tsx", "utf8")).toContain("Starting from their setup");
  });

  it("startingDose on its own: an advanced powerlifter benches 3× when there are 4+ days", () => {
    const d = startingDose({ brain: "powerlifting", level: "advanced", days: 4, liftingMinutes: 90, priorities: [], maxesOnFile: false });
    expect(d.frequency.find((f) => f.target === "Bench")?.perWeek).toBe(3);
    expect(d.volume.some((v) => v.target === "Chest")).toBe(false);
  });
});
