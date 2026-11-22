import { describe, expect, it } from "vitest";
import {
  addExercises,
  addSetGroup,
  duplicateExercise,
  duplicateSetGroup,
  exerciseUnits,
  inStepWeeks,
  linkedLoad,
  newPlan,
  newPlanExercise,
  normalizePlan,
  offeredScope,
  patchFields,
  planPayload,
  removeExercise,
  removeSetGroup,
  reorderExercise,
  scopeOptions,
  scopeWeeks,
  setBlockLength,
  addBlock,
  setExercise,
  setGroupName,
  slotAcross,
  swapExercise,
  topOf,
  weeksWords,
  type ProgramPlan,
} from "@/lib/program-plan";
import { cellPatch, cellText } from "@/lib/program-cells";

const SQ = "11111111-1111-4111-8111-111111111111";
const BP = "22222222-2222-4222-8222-222222222222";
const RW = "33333333-3333-4333-8333-333333333333";
const PU = "44444444-4444-4444-8444-444444444444";
const lib = (id: string, name: string) => ({ id, name, muscle_group: null, equipment: null });

/** 12 weeks, one day: squat, bench, row, built "every week". */
function built(): { plan: ProgramPlan; day: string; sq: string; bp: string; rw: string } {
  let plan = newPlan(12);
  const day = plan.blocks[0].weeks[0].days[0].key;
  const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
  plan = addExercises(plan, all, day, [
    newPlanExercise(lib(SQ, "Back Squat")),
    newPlanExercise(lib(BP, "Bench Press")),
    newPlanExercise(lib(RW, "Barbell Row")),
  ]).plan;
  const [sq, bp, rw] = plan.blocks[0].weeks[0].days[0].exercises.map((e) => e.key);
  return { plan, day, sq, bp, rw };
}
const exs = (plan: ProgramPlan, w: number) => plan.blocks[0].weeks[w].days[0].exercises;
const names = (plan: ProgramPlan, w: number) => exerciseUnits(plan.blocks[0].weeks[w].days[0]).map((u) => u.entries[0].name);

describe("dragging an exercise saves its new order", () => {
  it("moves the whole exercise, set groups and all, in every week of the scope", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = addSetGroup(plan, all, day, sq, "backoff").plan;
    // the squat (top set + back-offs) goes last
    const moved = reorderExercise(plan, all, { b: 0, w: 0 }, day, sq, 2);
    expect(names(moved, 0)).toEqual(["Bench Press", "Barbell Row", "Back Squat"]);
    expect(names(moved, 11)).toEqual(["Bench Press", "Barbell Row", "Back Squat"]);
    // its two set groups stay together, top set first
    expect(exs(moved, 5).slice(2).map((e) => e.role)).toEqual(["top", "backoff"]);
  });

  it("reaches only the weeks the scope names", () => {
    const { plan, day, rw } = built();
    const moved = reorderExercise(plan, scopeWeeks(plan, { b: 0, w: 2 }, "week"), { b: 0, w: 2 }, day, rw, 0);
    expect(names(moved, 2)).toEqual(["Barbell Row", "Back Squat", "Bench Press"]);
    expect(names(moved, 1)).toEqual(["Back Squat", "Bench Press", "Barbell Row"]);
    expect(names(moved, 3)).toEqual(["Back Squat", "Bench Press", "Barbell Row"]);
  });

  it("a week whose order differs gets the exercise after the same neighbour, nothing else moves", () => {
    let { plan, day, sq, bp, rw } = built();
    // week 4 runs row, squat, bench
    const w4 = plan.blocks[0].weeks[3].days[0];
    plan = structuredClone(plan);
    plan.blocks[0].weeks[3].days[0].exercises = [w4.exercises[2], w4.exercises[0], w4.exercises[1]];
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    // in week 1, bench goes first (before the squat)
    const moved = reorderExercise(plan, all, { b: 0, w: 0 }, day, bp, 0);
    expect(exs(moved, 0).map((e) => e.key)).toEqual([bp, sq, rw]);
    // week 4: bench goes first too; row and squat keep their order
    expect(exs(moved, 3).map((e) => e.key)).toEqual([bp, rw, sq]);
  });

  it("dropping where it was changes nothing", () => {
    const { plan, day, bp } = built();
    expect(reorderExercise(plan, scopeWeeks(plan, { b: 0, w: 0 }, "block"), { b: 0, w: 0 }, day, bp, 1)).toBe(plan);
  });
});

describe("duplicating", () => {
  it("copies the exercise right under it, numbers and notes kept, with its own keys", () => {
    let { plan, day, bp } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = setExercise(plan, all, day, bp, { sets: 4, reps: "6", rpe: "8", notes: "Pause the first rep" });
    const dup = duplicateExercise(plan, all, day, bp);
    expect(dup.skipped).toBe(0);
    const w = exs(dup.plan, 6);
    expect(w.map((e) => e.name)).toEqual(["Back Squat", "Bench Press", "Bench Press", "Barbell Row"]);
    expect(w[2]).toMatchObject({ sets: 4, reps: "6", rpe: "8", notes: "Pause the first rep" });
    expect(w[2].key).toBe(dup.key);
    expect(w[2].key).not.toBe(bp);
    // the same copy in every week (one key), so later edits reach it everywhere
    expect(new Set(slotAcross(dup.plan, all, day, dup.key!).map((e) => e?.key))).toEqual(new Set([dup.key]));
    // edited on its own: the original doesn't move
    const edited = setExercise(dup.plan, all, day, dup.key!, { reps: "10" });
    expect(exs(edited, 0).find((e) => e.key === bp)!.reps).toBe("6");
    expect(exs(edited, 0).find((e) => e.key === dup.key)!.reps).toBe("10");
  });

  it("copies every set group of an exercise as a new exercise", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = addSetGroup(plan, all, day, sq, "backoff").plan;
    const dup = duplicateExercise(plan, all, day, sq);
    const units = exerciseUnits(dup.plan.blocks[0].weeks[0].days[0]);
    expect(units.map((u) => u.entries.length)).toEqual([2, 2, 1, 1]);
    expect(units[1].group).not.toBe(units[0].group);
    expect(new Set([...units[0].entries, ...units[1].entries].map((e) => e.key)).size).toBe(4);
  });

  it("only in the weeks the scope names, and never past 20 exercises", () => {
    const { plan, day, rw } = built();
    const dup = duplicateExercise(plan, [{ b: 0, w: 1 }], day, rw);
    expect(exs(dup.plan, 1)).toHaveLength(4);
    expect(exs(dup.plan, 0)).toHaveLength(3);
    let full = plan;
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    full = addExercises(full, all, day, Array.from({ length: 17 }, () => newPlanExercise(lib(PU, "Pull Up")))).plan;
    const none = duplicateExercise(full, all, day, rw);
    expect(none.skipped).toBe(12);
    expect(exs(none.plan, 0)).toHaveLength(20);
  });

  it("duplicates one set group inside an exercise", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    const back = addSetGroup(plan, all, day, sq, "backoff");
    plan = back.plan;
    const copy = duplicateSetGroup(plan, all, day, back.key);
    const unit = exerciseUnits(copy.plan.blocks[0].weeks[3].days[0])[0];
    expect(unit.entries.map((e) => e.role)).toEqual(["top", "backoff", "backoff"]);
    expect(unit.entries[2].key).toBe(copy.key);
    expect(unit.entries[2]).toMatchObject({ pct: 90, pct_of: "top_set", sets: 2 });
    // a plain exercise's sets copied become a second group of the same exercise
    const plain = duplicateSetGroup(plan, all, day, exs(plan, 0)[2].key);
    expect(exerciseUnits(plain.plan.blocks[0].weeks[0].days[0]).map((u) => u.entries.length)).toEqual([2, 2, 1]);
  });
});

describe("top sets and back-offs in one exercise", () => {
  it("adds back-offs at 90% of the top set as a set group of the same exercise", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = setExercise(plan, all, day, sq, { sets: 1, reps: "3", rpe: "8" });
    const out = addSetGroup(plan, all, day, sq, "backoff");
    const unit = exerciseUnits(out.plan.blocks[0].weeks[9].days[0])[0];
    expect(unit.entries).toHaveLength(2);
    expect(unit.entries[0]).toMatchObject({ role: "top", sets: 1, reps: "3", rpe: "8" });
    expect(unit.entries[1]).toMatchObject({ exercise_id: SQ, role: "backoff", sets: 2, reps: "3", pct: 90, pct_of: "top_set", rpe: null });
    expect(setGroupName(unit.entries[0])).toBe("Top set");
    expect(setGroupName(unit.entries[1])).toBe("Back-off");
    expect(topOf(unit).key).toBe(sq);
  });

  it("warm-ups go before the working sets, other groups after", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = addSetGroup(plan, all, day, sq, "backoff").plan;
    plan = addSetGroup(plan, all, day, sq, "warmup").plan;
    plan = addSetGroup(plan, all, day, sq, "more").plan;
    const unit = exerciseUnits(plan.blocks[0].weeks[0].days[0])[0];
    expect(unit.entries.map((e) => setGroupName(e))).toEqual(["Warm-up", "Top set", "Back-off", "Back-off"]);
    expect(unit.entries[0]).toMatchObject({ sets: 2, reps: "5", pct: 60, pct_of: "top_set" });
    // the top set is still the one the others read
    expect(topOf(unit).key).toBe(sq);
  });

  it("works the back-off weight out from the top set and follows it when it changes", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = setExercise(plan, all, day, sq, { load: 405, unit: "lb" });
    const out = addSetGroup(plan, all, day, sq, "backoff");
    plan = out.plan;
    const d0 = () => plan.blocks[0].weeks[0].days[0];
    expect(linkedLoad(d0(), out.key)).toEqual({ load: 365, unit: "lb", of: 405 });
    plan = setExercise(plan, all, day, sq, { load: 425 });
    expect(linkedLoad(d0(), out.key)!.load).toBe(385); // 382.5 → nearest 5 lb
    plan = setExercise(plan, all, day, out.key, { round: "fine" });
    expect(linkedLoad(d0(), out.key)!.load).toBe(382.5);
    // −10% typed into a % of the top set is 90%
    const e = d0().exercises.find((x) => x.key === out.key)!;
    expect(cellPatch(e, "load", "-15", "pct_top")).toEqual({ pct: 85, pct_of: "top_set", load: null, unit: null });
    expect(cellPatch(e, "load", "−5%", "pct_top")).toEqual({ pct: 95, pct_of: "top_set", load: null, unit: null });
    expect(cellText(e, "load")).toEqual({ value: "90", unit: "% top" });
    // a back-off with its own weight is independent of the top set
    plan = setExercise(plan, all, day, out.key, { load: 315, unit: "lb" });
    expect(linkedLoad(d0(), out.key)).toBeNull();
    // in kg it rounds to 2.5 kg (1 kg when fine)
    let kg = setExercise(plan, all, day, sq, { load: 182.5, unit: "kg" });
    kg = setExercise(kg, all, day, out.key, { pct: 92.5, pct_of: "top_set", round: null });
    expect(linkedLoad(kg.blocks[0].weeks[0].days[0], out.key)!.load).toBe(170);
    // an RPE top set: the logger works it out from what's lifted
    const rpe = setExercise(plan, all, day, sq, { load: null, pct: null, pct_of: null, unit: null, rpe: "8" });
    expect(linkedLoad(rpe.blocks[0].weeks[0].days[0], out.key)).toBeNull();
  });

  it("each set group is edited on its own; removing one leaves the exercise", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    const back = addSetGroup(plan, all, day, sq, "backoff");
    plan = setExercise(back.plan, all, day, back.key, { sets: 3, reps: "5", rpe: "7" });
    expect(exs(plan, 0)[0]).toMatchObject({ sets: 3, reps: "8-10", rpe: null });
    const one = removeSetGroup(plan, all, day, back.key);
    expect(exs(one, 0)).toHaveLength(3);
    // a lone exercise again: no group, no "Top set"
    expect(exs(one, 0)[0]).toMatchObject({ key: sq, group: null, role: null });
    // the last group can't be removed that way (remove the exercise)
    expect(removeSetGroup(one, all, day, sq)).toEqual(one);
    expect(exs(removeExercise(plan, all, day, sq), 0).map((e) => e.name)).toEqual(["Bench Press", "Barbell Row"]);
  });

  it("swapping swaps every set group, keeping each one's numbers", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    const back = addSetGroup(plan, all, day, sq, "backoff");
    plan = swapExercise(back.plan, all, day, back.key, lib(PU, "Front Squat"));
    expect(exs(plan, 0).slice(0, 2).map((e) => [e.name, e.role])).toEqual([["Front Squat", "top"], ["Front Squat", "backoff"]]);
  });

  it("saves and reads back set groups (and drops what the database wouldn't keep)", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    const back = addSetGroup(plan, all, day, sq, "backoff");
    plan = setExercise(back.plan, all, day, back.key, { round: "fine", label: "Pause sets" });
    const payload = planPayload(plan);
    const ex = payload.blocks[0].weeks[0].days[0].exercises;
    expect(ex[0]).toMatchObject({ role: "top", group: ex[1].group, round: null });
    expect(ex[1]).toMatchObject({ role: "backoff", label: "Pause sets", round: "fine" });
    const back2 = normalizePlan(payload)!;
    expect(exerciseUnits(back2.blocks[0].weeks[0].days[0]).map((u) => u.entries.length)).toEqual([2, 1, 1]);
    expect(setGroupName(back2.blocks[0].weeks[0].days[0].exercises[1])).toBe("Pause sets");
    // a fixed weight never carries a rounding
    const fixed = setExercise(plan, all, day, back.key, { load: 300, unit: "lb" });
    expect(planPayload(fixed).blocks[0].weeks[0].days[0].exercises[1].round).toBeNull();
  });
});

describe("which weeks an edit changes", () => {
  it("names each choice with its exact weeks, never offering the same weeks twice", () => {
    const { plan } = built();
    expect(scopeOptions(plan, { b: 0, w: 2 }).map((o) => [o.scope, o.title, o.range])).toEqual([
      ["week", "This week", "Week 3"],
      ["following", "Rest of program", "Weeks 3–12"],
      ["block", "All weeks", "Weeks 1–12"],
    ]);
    // week 1: "rest of" is every week; the last week: it's this week
    expect(scopeOptions(plan, { b: 0, w: 0 }).map((o) => o.scope)).toEqual(["week", "block"]);
    expect(scopeOptions(plan, { b: 0, w: 11 }).map((o) => o.scope)).toEqual(["week", "block"]);
    const three = addBlock(addBlock(setBlockLength(plan, 0, 4), 4), 4);
    expect(scopeOptions(three, { b: 1, w: 1 }).map((o) => [o.title, o.range])).toEqual([
      ["This week", "Week 6"],
      ["Rest of block", "Weeks 6–8"],
      ["This block", "Weeks 5–8"],
      ["All weeks", "Weeks 1–12"],
    ]);
    expect(scopeWeeks(three, { b: 1, w: 1 }, "program")).toHaveLength(12);
    // a choice that isn't offered reads as the one reaching the same weeks
    expect(offeredScope(plan, { b: 0, w: 0 }, "following")).toBe("block");
    expect(offeredScope(plan, { b: 0, w: 11 }, "following")).toBe("week");
  });

  it("an edit across weeks keeps the numbers a week was given on purpose", () => {
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    // weeks 1–4 progress RPE 7, 7.5, 8, 8.5; the rest have none
    plan = setExercise(plan, [{ b: 0, w: 1 }], day, sq, { rpe: "7.5" });
    plan = setExercise(plan, [{ b: 0, w: 2 }], day, sq, { rpe: "8" });
    plan = setExercise(plan, [{ b: 0, w: 3 }], day, sq, { rpe: "8.5" });
    // changing week 1's RPE for "all weeks" reaches the weeks in step with it, not 2–4
    const { reach, own } = inStepWeeks(plan, { b: 0, w: 0 }, all, day, sq, patchFields({ rpe: "7" }));
    expect(reach.map((r) => r.w)).toEqual([0, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(own.map((r) => r.w)).toEqual([1, 2, 3]);
    expect(weeksWords(plan, own)).toBe("weeks 2–4");
    const out = setExercise(plan, reach, day, sq, { rpe: "7" });
    expect(slotAcross(out, all, day, sq).map((e) => e!.rpe)).toEqual(["7", "7.5", "8", "8.5", ...Array(8).fill("7")]);
    // other fields are in step everywhere, so a reps edit still reaches every week
    expect(inStepWeeks(out, { b: 0, w: 0 }, all, day, sq, patchFields({ reps: "5" })).own).toHaveLength(0);
    expect(weeksWords(plan, [{ b: 0, w: 1 }, { b: 0, w: 4 }, { b: 0, w: 5 }, { b: 0, w: 8 }])).toBe("weeks 2, 5–6 and 9");
  });
});

describe("an imported top set and its back-offs", () => {
  it("become one exercise with set groups", async () => {
    const { linkTopSets } = await import("@/lib/program-plan");
    let { plan, day, sq } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    // the importer writes them as two lines of the same lift
    const second = { ...newPlanExercise(lib(SQ, "Back Squat")), pct: 90, pct_of: "top_set" as const };
    plan = addExercises(plan, all, day, [second], sq).plan;
    const linked = linkTopSets(plan);
    const unit = exerciseUnits(linked.blocks[0].weeks[2].days[0])[0];
    expect(unit.entries.map((e) => e.role)).toEqual(["top", "backoff"]);
    expect(exerciseUnits(linked.blocks[0].weeks[2].days[0])).toHaveLength(3);
    // nothing else is grouped
    expect(exerciseUnits(linkTopSets(built().plan).blocks[0].weeks[0].days[0]).every((u) => u.entries.length === 1)).toBe(true);
  });
});

describe("set groups reach the athlete's workouts", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const sql = readFileSync("supabase/migrations/20270509090000_program_builder_set_groups.sql", "utf8");
  const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");

  it("saving keeps each group's role, name, group and rounding", () => {
    expect(sql).toContain("v_role := CASE WHEN e->>'role' IN ('warmup', 'top', 'backoff') THEN e->>'role' END;");
    expect(sql).toContain("'round', CASE WHEN e->>'round' = 'fine' AND v_pct_of = 'top_set' THEN 'fine' END));");
  });

  it("each working group is its own row, named the way the logger reads it, and a back-off reads its own top set", () => {
    expect(sql).toContain("CASE v_role WHEN 'top' THEN 'Top Set' WHEN 'backoff' THEN 'Back-off' WHEN 'warmup' THEN 'Warm-up' END);");
    expect(sql).toContain("THEN (v_tops->>v_group)::uuid END;");
    // warm-ups never become working sets: they lead the exercise's note
    expect(sql).toContain("THEN 'Warm-up: ' || public.athlete_program_warmup_words(e)");
  });

  it("the logger rounds a % of the top set to the program's plates", () => {
    expect(sql).toContain("CHECK (load_round IS NULL OR load_round = 'fine')");
    expect(logger).toContain("const step = backoffRoundStep(activeUnit, row.load_round);");
    expect(logger).toContain('if (round === "fine") return unit === "kg" ? 1 : 2.5;');
  });
});
