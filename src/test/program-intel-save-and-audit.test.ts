/**
 * Nov 23 2026: Dwayne's Generate Next Program run stopped at "Saving the hidden draft" with
 * `null value in column "manual_override"`, after an audit that "failed validation after 2 repair
 * rounds" on checks that read the program wrong. Each piece of that run is pinned here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pctOfMax, targetPattern } from "@/lib/program-intel/audit";
import { programInLocalWeeks, rxForWeek, withLocalWeeks } from "@/lib/program-intel/program-view";
import { blockPhases } from "@/lib/program-intel/generator-prompts";
import { stoppedWords } from "@/lib/program-intel/run-eta";
import type { BuiltBlock } from "@/lib/program-intel/generator-schemas";
import { builtBlockSchema, strategySchema } from "@/lib/program-intel/generator-schemas";
import { cleanProgramName, isGeneratedLabel, meetProgramName, programIntelNote, programNameFor } from "@/lib/program-intel/program-name";

const read = (p: string) => readFileSync(p, "utf8");

const ex = (name: string, extra: any = {}) => ({ exercise_id: "e", exercise_name: name, role: null, station: null, superset: null, sets: 1, reps: "3", rpe: "7", rir: null, percentage: null, percentage_of: null, rest_seconds: 240, tempo: null, progression: null, substitutions: [], notes: null, weeks: [], ...extra });
const block = (weeks: number, phases: number[], changes: number[]): BuiltBlock =>
  ({
    name: "Strength Intensification",
    objective: null,
    weeks,
    week_phases: phases.map((w) => ({ week: w, phase: `P${w}` })),
    deload_rule: null,
    progression_rules: [],
    days: [{ title: "Monday", exercises: [ex("Competition Squat", { weeks: changes.map((w) => ({ week: w, reps: "5", rpe: "7.5" })) })] }],
  }) as any;

describe("a block's weeks are its own, even when the model counted on from the program's first week", () => {
  it("block 2 of a 6 + 6 written as weeks 7–12 is read back as 1–6, so no week's change is lost", () => {
    const b = block(6, [7, 8, 9, 10, 11, 12], [8, 9, 10, 11, 12]);
    // as the run had it: week 2 of the block was just the base (a triple), its fives were lost
    expect(rxForWeek(b.days[0].exercises[0], 2).reps).toBe("3");
    const { block: local, shifted } = withLocalWeeks(b, 6);
    expect(shifted).toBe(6);
    expect(local.week_phases.map((p) => p.week)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(local.week_phases[0].phase).toBe("P7");
    expect(rxForWeek(local.days[0].exercises[0], 2).reps).toBe("5");
  });
  it("a block already in its own weeks, the first block, or references that don't fit the block's place are left as written", () => {
    const own = block(6, [1, 2, 6], [2, 4]);
    expect(withLocalWeeks(own, 6).shifted).toBe(0);
    expect(withLocalWeeks(block(6, [7, 8], [8]), 0).shifted).toBe(0);
    // a reference past the block's place in the program is the audit's to name, never guessed at
    expect(withLocalWeeks(block(6, [7, 14], []), 6).shifted).toBe(0);
  });
  it("a whole program is put right block by block, each by the weeks before it", () => {
    const { program, moved } = programInLocalWeeks({ blocks: [block(6, [1, 6], [2]), block(6, [7, 12], [8])] });
    expect(moved).toEqual([1]);
    expect(program.blocks[1].week_phases.map((p) => p.week)).toEqual([1, 6]);
    expect(program.blocks[0].week_phases.map((p) => p.week)).toEqual([1, 6]);
  });
  it("a phase past week 12 is kept by the schema (to be read back), never silently dropped", () => {
    const parsed = builtBlockSchema.parse({ ...block(12, [13, 24], []), objective: "x" });
    expect(parsed.week_phases.map((p) => p.week)).toEqual([13, 24]);
  });
  it("the construct prompt shows a strategy's block phases in the block's own weeks and says so", () => {
    const strategy: any = { structure: { blocks: [{ name: "A", weeks: 6, objective: "", phases: [{ week: 1, phase: "a" }] }, { name: "B", weeks: 6, objective: "", phases: [{ week: 7, phase: "Intensification 1" }, { week: 12, phase: "Benchmark" }] }] } };
    expect(blockPhases(strategy, 1)).toEqual([{ week: 1, phase: "Intensification 1" }, { week: 6, phase: "Benchmark" }]);
    expect(blockPhases(strategy, 0)).toEqual([{ week: 1, phase: "a" }]);
    expect(read("src/lib/program-intel/generator-prompts.ts")).toContain("never counted on from earlier blocks");
  });
  it("the worker reads every block in its own weeks when it builds, repairs, audits and saves", () => {
    const pipe = read("src/lib/program-intel/pipeline.server.ts");
    expect(pipe.match(/withLocalWeeks\(value/g)?.length).toBe(2);
    expect(pipe).toContain("blocks: programInLocalWeeks({ blocks: result.blocks as BuiltBlock[] }).program.blocks");
    expect(pipe).toContain("const program: BuiltProgram = programInLocalWeeks(result.program as BuiltProgram).program;");
  });
});

describe("a draft block is named once", () => {
  it("a name the model already numbered isn't numbered twice", async () => {
    const { draftBlockName } = await import("@/lib/program-intel/pipeline.server");
    expect(draftBlockName("Block 1 — Foundation / Re-Specificity Accumulation", 0, 2)).toBe("Block 1 — Foundation / Re-Specificity Accumulation");
    expect(draftBlockName("Strength Intensification", 1, 2)).toBe("Block 2 — Strength Intensification");
    expect(draftBlockName("Block 2: Peak", 1, 2)).toBe("Block 2 — Peak");
    expect(draftBlockName("Hypertrophy", 0, 1)).toBe("Hypertrophy");
  });
});

describe("the save never fails on a column one row leaves out", () => {
  it("draft rows and Cleo's rows are inserted with each missing column taking its default, never null", () => {
    // a back-off at a % carries manual_override: false, the top set beside it doesn't; a NOT NULL column
    // filled with null for the top set refused the whole day
    expect(read("src/lib/program-intel/pipeline.server.ts")).toContain('insert(rows, { defaultToNull: false })');
    expect(read("src/lib/cleo-program.server.ts")).toContain('insert(payload, { defaultToNull: false })');
  });
});

describe("the audit reads what it can read, and only that", () => {
  it("a % of today's top set or of a training max is never judged as a % of a max", () => {
    expect(pctOfMax("top_set")).toBe(false);
    expect(pctOfMax("training_max")).toBe(false);
    expect(pctOfMax("1rm")).toBe(true);
    expect(pctOfMax("e1rm")).toBe(true);
    expect(pctOfMax(null)).toBe(true);
  });
  it("a single-leg target counts lunges and split squats, and a target it can't read is never 0×", () => {
    expect(targetPattern("Direct single-leg work")).toBe("single_leg");
    expect(targetPattern("Quads")).toBeNull();
    const audit = read("src/lib/program-intel/audit.ts");
    expect(audit).toContain("Can't be counted automatically");
    expect(audit).toMatch(/lunge\|split\[- \]\?squat\|bulgarian/);
  });
  it("the coaching review's must-fixes get their repair even after the audit's two rounds", () => {
    expect(read("src/lib/program-intel/pipeline.server.ts")).toContain("const repairing = blocks.length > 0;");
  });
});

describe("a stopped run says why once, in plain words", () => {
  it("a database refusal is the app's problem, rolled back whole; the raw message is kept under Details", () => {
    const w = stoppedWords('null value in column "manual_override" of relation "pl_exercise_rows" violates not-null constraint');
    expect(w.headline).toBe("The draft couldn't be saved. Nothing was left half-written.");
    expect(w.detail).toContain("manual_override");
    expect(stoppedWords("Block 2 didn't match the strategy: 3 days").headline).toBe("Block 2 didn't match the strategy: 3 days");
    expect(stoppedWords(null).headline).toBe("The run stopped.");
  });
  it("the step says Stopped here, the card holds the reason, and the toast doesn't repeat it", () => {
    const card = read("src/components/program-intel/generator/draft-view.tsx");
    expect(card).toContain('"Stopped here"');
    expect(card).toContain("stoppedWords(job.error)");
    expect(read("src/components/program-intel/generator/workstation.tsx")).not.toContain("description: j.error");
    expect(read("src/components/program-intel/generator/overview.tsx")).not.toContain("uppercase tracking-widest text-muted-foreground\">{children}");
  });
});

describe("a generated program is named like the coach names one (Dwayne: Westerns Prep)", () => {
  const base = { brain: "powerlifting" as const, weeks: 12, days: 4 };
  it("the strategy's name wins, cleaned of the athlete's name, quotes and stops", () => {
    expect(programNameFor({ ...base, named: "Westerns Prep" })).toBe("Westerns Prep");
    expect(programNameFor({ ...base, named: "Dwayne's Westerns Prep", firstName: "Dwayne" })).toBe("Westerns Prep");
    expect(programNameFor({ ...base, named: '"Westerns Prep."', firstName: "Dwayne" })).toBe("Westerns Prep");
    expect(cleanProgramName("Marathon Prep", "Mar")).toBe("Marathon Prep");
    expect(cleanProgramName("Westerns Prep (Dwayne)", "Dwayne")).toBe("Westerns Prep");
  });
  it("a length, a block or the generator's label is no name", () => {
    expect(cleanProgramName("Powerlifting · 12 weeks · 4 days")).toBeNull();
    expect(cleanProgramName("Block 1")).toBeNull();
    expect(cleanProgramName("12-Week Program")).toBeNull();
    expect(cleanProgramName("x".repeat(70))).toBeNull();
  });
  it("with no name from the strategy, the meet it builds toward names it", () => {
    expect(meetProgramName("CanPL Western Canadian Championships 2027")).toBe("Western Canadian Championships Prep");
    expect(meetProgramName("2027 Canadian Nationals")).toBe("Canadian Nationals Prep");
    expect(meetProgramName("OPA Championships")).toBe("Championships Prep");
    expect(programNameFor({ ...base, named: "", goal: { kind: "meet", name: "IPF Worlds 2027", date: "2027-06-01" } })).toBe("Worlds Prep");
    expect(programNameFor({ ...base, named: "", goal: { kind: "goal", name: "Total 600 kg", date: "2027-06-01" } })).toBe("Total 600 kg");
  });
  it("with nothing to go on it keeps the generator's label, which is never written onto the athlete's program", () => {
    const name = programNameFor({ ...base, named: null, goal: null });
    expect(name).toBe("Powerlifting · 12 weeks · 4 days");
    expect(isGeneratedLabel(name)).toBe(true);
    expect(isGeneratedLabel("Westerns Prep")).toBe(false);
    expect(read("src/lib/program-intel/intel.functions.ts")).toContain("if (!title || isGeneratedLabel(title)) return null;");
  });
  it("the strategy is asked for a name and reads without one (an approved strategy from before)", () => {
    expect(read("src/lib/program-intel/generator-prompts.ts")).toContain('"program_name": string');
    expect(strategySchema.shape.program_name.safeParse(undefined).success).toBe(true);
    expect(strategySchema.shape.program_name.safeParse({ a: 1 }).success).toBe(true);
  });
  it("assigning puts the blocks under one program record with that name; the draft note says it's assigned", () => {
    const fn = read("src/lib/program-intel/intel.functions.ts");
    expect(fn).toContain('.from("pl_preps")');
    expect(fn).toContain("if (x.blocks.some((b) => b.prep_id)) return null;");
    expect(fn).toContain("export const renameIntelProgramFn");
    const draft = "Draft from Program Intelligence (Powerlifting · 12 weeks · 4 days). Not visible to the client until you assign it. Deload: Week 6.";
    expect(programIntelNote(draft, "Westerns Prep", false)).toBe("From Program Intelligence (Westerns Prep). Deload: Week 6.");
    expect(programIntelNote(draft, "Westerns Prep", true)).toBe("Draft from Program Intelligence (Westerns Prep). Not visible to the client until you assign it. Deload: Week 6.");
    expect(programIntelNote("From Program Intelligence (Westerns Prep (CanPL)). Keep it.", "Westerns", false)).toBe("From Program Intelligence (Westerns). Keep it.");
    expect(programIntelNote("My own note", "Westerns Prep", false)).toBe("My own note");
    expect(programIntelNote(null, "Westerns Prep", false)).toBeNull();
  });
});
