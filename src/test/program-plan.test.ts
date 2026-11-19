import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_WEEKS,
  addBackoff,
  addBlock,
  addDay,
  addExercises,
  applyProgression,
  changedFromLastWeek,
  copyDayTo,
  copyWeekTo,
  defaultScope,
  duplicateDay,
  duplicateWeek,
  fieldNumber,
  flatWeeks,
  loadText,
  newPlan,
  newPlanExercise,
  normalizePlan,
  planFromDays,
  planIssue,
  planMeta,
  planPayload,
  prescriptionText,
  programWeek,
  progressionValues,
  removeBlock,
  removeDay,
  removeExercise,
  removeWeek,
  samePlan,
  scopeLabel,
  scopeWeeks,
  setBlockLength,
  setExercise,
  setProgramLength,
  slotAcross,
  totalWeeks,
  type ProgramPlan,
} from "@/lib/program-plan";

const EX = "11111111-1111-4111-8111-111111111111";
const EX2 = "22222222-2222-4222-8222-222222222222";
const lib = (id: string, name: string) => ({ id, name, muscle_group: null, equipment: null });

/** A 12-week, one-block program whose day has a squat, built "every week". */
function built(): { plan: ProgramPlan; day: string; squat: string } {
  let plan = newPlan(12);
  const day = plan.blocks[0].weeks[0].days[0].key;
  const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
  plan = addExercises(plan, all, day, [newPlanExercise(lib(EX, "Back Squat"))]).plan;
  const squat = plan.blocks[0].weeks[0].days[0].exercises[0].key;
  return { plan, day, squat };
}

describe("a program is blocks of weeks of days, every week written out", () => {
  it("starts as 12 linked weeks in one block", () => {
    const plan = newPlan();
    expect(plan.blocks).toHaveLength(1);
    expect(totalWeeks(plan)).toBe(12);
    // every week has the same day (one key), so an edit can reach them all
    const keys = new Set(flatWeeks(plan).map((x) => x.week.days[0].key));
    expect(keys.size).toBe(1);
    expect(defaultScope(plan, 0)).toBe("block");
  });

  it("built once with 'every week', each week has its own copy of the same exercise", () => {
    const { plan, day, squat } = built();
    const across = slotAcross(plan, scopeWeeks(plan, { b: 0, w: 0 }, "block"), day, squat);
    expect(across.every((e) => e?.exercise_id === EX)).toBe(true);
    expect(new Set(across.map((e) => e)).size).toBe(12); // copies, not one shared object
  });

  it("an edit reaches exactly the weeks its scope names", () => {
    const { plan, day, squat } = built();
    const at = { b: 0, w: 2 };
    const one = setExercise(plan, scopeWeeks(plan, at, "week"), day, squat, { reps: "5" });
    expect(slotAcross(one, scopeWeeks(one, { b: 0, w: 0 }, "block"), day, squat).map((e) => e!.reps)).toEqual(
      ["8-10", "8-10", "5", ...Array(9).fill("8-10")],
    );
    const later = setExercise(plan, scopeWeeks(plan, at, "following"), day, squat, { reps: "5" });
    expect(slotAcross(later, scopeWeeks(later, { b: 0, w: 0 }, "block"), day, squat).map((e) => e!.reps)).toEqual(
      ["8-10", "8-10", ...Array(10).fill("5")],
    );
    // once weeks differ, the builder opens on "this week only"
    expect(defaultScope(one, 0)).toBe("week");
  });

  it("names the weeks an edit reaches", () => {
    const { plan } = built();
    expect(scopeLabel(plan, { b: 0, w: 2 }, "week")).toBe("Week 3 only");
    expect(scopeLabel(plan, { b: 0, w: 2 }, "following")).toBe("Weeks 3–12");
    expect(scopeLabel(plan, { b: 0, w: 2 }, "block")).toBe("All 12 weeks");
    const two = addBlock(setBlockLength(plan, 0, 4), 4);
    expect(scopeLabel(two, { b: 1, w: 1 }, "block")).toBe("All of Block 2 (weeks 5–8)");
    expect(programWeek(two, { b: 1, w: 1 })).toBe(6);
  });

  it("finds the same exercise by its key even when a week's order differs", () => {
    let { plan, day, squat } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    plan = addExercises(plan, [{ b: 0, w: 5 }], day, [newPlanExercise(lib(EX2, "RDL"))], null).plan;
    // move the RDL above the squat in week 6 only, then edit the squat everywhere
    const rdl = plan.blocks[0].weeks[5].days[0].exercises[1].key;
    plan = { ...plan };
    const w6 = plan.blocks[0].weeks[5].days[0];
    plan.blocks[0].weeks[5].days[0] = { ...w6, exercises: [w6.exercises[1], w6.exercises[0]] };
    const next = setExercise(plan, all, day, squat, { sets: 5 });
    expect(next.blocks[0].weeks[5].days[0].exercises.find((e) => e.key === squat)!.sets).toBe(5);
    expect(next.blocks[0].weeks[5].days[0].exercises.find((e) => e.key === rdl)!.sets).toBe(3);
  });

  it("a weight and a percentage never sit together; one effort scale at a time", () => {
    const { plan, day, squat } = built();
    const w = [{ b: 0, w: 0 }];
    let p = setExercise(plan, w, day, squat, { load: 100, unit: "kg" });
    p = setExercise(p, w, day, squat, { pct: 75, pct_of: "1rm" });
    const e = p.blocks[0].weeks[0].days[0].exercises[0];
    expect([e.load, e.pct, e.pct_of]).toEqual([null, 75, "1rm"]);
    p = setExercise(p, w, day, squat, { rpe: "8" });
    p = setExercise(p, w, day, squat, { rir: "2" });
    const f = p.blocks[0].weeks[0].days[0].exercises[0];
    expect([f.rpe, f.rir]).toEqual([null, "2"]);
    expect(loadText({ load: 102.5, unit: "lb" })).toBe("102.5 lb");
    expect(loadText({ pct: 90, pct_of: "top_set" })).toBe("90% of top set");
  });

  it("back-offs are the same lift again at 90% of the top set", () => {
    const { plan, day, squat } = built();
    const p = addBackoff(plan, scopeWeeks(plan, { b: 0, w: 0 }, "block"), day, squat);
    const ex = p.blocks[0].weeks[7].days[0].exercises;
    expect(ex).toHaveLength(2);
    expect(ex[1]).toMatchObject({ exercise_id: EX, sets: 2, pct: 90, pct_of: "top_set", rpe: null });
    expect(prescriptionText(ex[1])).toBe("2 × 8-10 · 90% of top set · 2:00 rest");
  });
});

describe("weeks, days and blocks", () => {
  it("copies a week onto others and duplicates one in place", () => {
    const { plan, day, squat } = built();
    const changed = setExercise(plan, [{ b: 0, w: 0 }], day, squat, { reps: "3" });
    const copied = copyWeekTo(changed, { b: 0, w: 0 }, [{ b: 0, w: 1 }, { b: 0, w: 2 }]);
    expect(copied.blocks[0].weeks.slice(0, 4).map((w) => w.days[0].exercises[0].reps)).toEqual(["3", "3", "3", "8-10"]);
    const dup = duplicateWeek(setBlockLength(changed, 0, 4), { b: 0, w: 0 });
    expect(dup.blocks[0].weeks.map((w) => w.days[0].exercises[0].reps)).toEqual(["3", "3", "8-10", "8-10", "8-10"]);
  });

  it("copies a day into weeks that don't have it yet", () => {
    let { plan } = built();
    const added = addDay(plan, [{ b: 0, w: 0 }], "Upper");
    plan = added.plan;
    expect(plan.blocks[0].weeks[1].days).toHaveLength(1);
    const out = copyDayTo(plan, { b: 0, w: 0 }, added.key, scopeWeeks(plan, { b: 0, w: 0 }, "block"));
    expect(out.blocks[0].weeks[11].days.map((d) => d.title)).toEqual(["Day 1", "Upper"]);
  });

  it("a duplicated day is its own day; removing one keeps at least one a week", () => {
    const { plan, day } = built();
    const all = scopeWeeks(plan, { b: 0, w: 0 }, "block");
    const dup = duplicateDay(plan, all, day);
    expect(dup.plan.blocks[0].weeks[3].days.map((d) => d.title)).toEqual(["Day 1", "Day 1 (copy)"]);
    expect(dup.plan.blocks[0].weeks[3].days[1].exercises[0].key).not.toBe(plan.blocks[0].weeks[0].days[0].exercises[0].key);
    expect(removeDay(plan, all, day).blocks[0].weeks[0].days).toHaveLength(1);
    expect(removeDay(dup.plan, all, day).blocks[0].weeks[0].days.map((d) => d.title)).toEqual(["Day 1 (copy)"]);
  });

  it("a block grows from its last week, shrinks from its end, and keeps a week", () => {
    const { plan, day, squat } = built();
    const last = setExercise(setBlockLength(plan, 0, 4), [{ b: 0, w: 3 }], day, squat, { reps: "3" });
    const grown = setBlockLength(last, 0, 6);
    expect(grown.blocks[0].weeks.map((w) => w.days[0].exercises[0].reps)).toEqual(
      ["8-10", "8-10", "8-10", "3", "3", "3"],
    );
    expect(totalWeeks(setProgramLength(plan, 16))).toBe(16);
    expect(totalWeeks(setProgramLength(plan, 99))).toBe(MAX_WEEKS);
    expect(removeWeek(setBlockLength(plan, 0, 1), { b: 0, w: 0 })).toEqual(setBlockLength(plan, 0, 1));
  });

  it("a new block carries on from the last week of the one before, inside 24 weeks", () => {
    const { plan } = built();
    const two = addBlock(setBlockLength(plan, 0, 4));
    expect(two.blocks.map((b) => [b.name, b.weeks.length])).toEqual([["Block 1", 4], ["Block 2", 4]]);
    expect(two.blocks[1].weeks[0].days[0].exercises[0].exercise_id).toBe(EX);
    expect(totalWeeks(addBlock(setBlockLength(plan, 0, 22)))).toBe(MAX_WEEKS);
    expect(removeBlock(two, 1).blocks).toHaveLength(1);
    expect(removeBlock(removeBlock(two, 1), 0).blocks).toHaveLength(1);
    expect(planMeta(two)).toBe("8 weeks · 2 blocks · 1 day a week");
  });

  it("removing an exercise in one week leaves the rest", () => {
    const { plan, day, squat } = built();
    const out = removeExercise(plan, [{ b: 0, w: 4 }], day, squat);
    expect(out.blocks[0].weeks[4].days[0].exercises).toHaveLength(0);
    expect(out.blocks[0].weeks[5].days[0].exercises).toHaveLength(1);
  });
});

describe("progression across weeks", () => {
  it("a straight line in sensible steps, inside the field's range", () => {
    expect(progressionValues("rpe", 7, 0.5, 4)).toEqual([7, 7.5, 8, 8.5]);
    expect(progressionValues("rpe", 9, 1, 3)).toEqual([9, 10, 10]);
    expect(progressionValues("reps", 10, -2, 6)).toEqual([10, 8, 6, 4, 2, 1]);
    expect(progressionValues("sets", 3, 0.4, 4)).toEqual([3, 3, 4, 4]);
    expect(progressionValues("load", 100, 2.5, 3)).toEqual([100, 102.5, 105]);
  });

  it("writes each week's own value and shows what changed from the week before", () => {
    const { plan, day, squat } = built();
    const weeks = scopeWeeks(plan, { b: 0, w: 0 }, "block").slice(0, 4);
    const p = applyProgression(plan, weeks, day, squat, "rpe", [7, 7.5, 8, 8.5]);
    expect(slotAcross(p, weeks, day, squat).map((e) => e!.rpe)).toEqual(["7", "7.5", "8", "8.5"]);
    expect([...changedFromLastWeek(p, { b: 0, w: 1 }, day, squat)]).toEqual(["rpe"]);
    expect(changedFromLastWeek(p, { b: 0, w: 0 }, day, squat).size).toBe(0);
    expect(fieldNumber(slotAcross(p, weeks, day, squat)[0], "reps")).toBe(10);
  });
});

describe("checking and saving", () => {
  it("points at the name or the exact week and day to fix", () => {
    const fresh = newPlan(4);
    expect(planIssue("x", fresh)).toMatchObject({ at: "title" });
    expect(planIssue("Upper / Lower", fresh)).toEqual({ message: "Add an exercise to Day 1 (week 1).", at: { b: 0, w: 0, d: 0 } });
    const { plan, day, squat } = built();
    expect(planIssue("Squat block", plan)).toBeNull();
    const bad = setExercise(plan, [{ b: 0, w: 6 }], day, squat, { rpe: "12" });
    expect(planIssue("Squat block", bad)).toEqual({ message: "RPE is 1 to 10, like 8 or 7-8 (Day 1 (week 7)).", at: { b: 0, w: 6, d: 0 } });
  });

  it("saves ids and numbers only; names come from the library", () => {
    const { plan } = built();
    const e = planPayload(plan).blocks[0].weeks[0].days[0].exercises[0];
    expect(e).not.toHaveProperty("name");
    expect(e).toMatchObject({ exercise_id: EX, sets: 3, reps: "8-10", load: null, unit: null, pct: null });
  });

  it("a program from before plans reads as its week repeated; junk is refused", () => {
    const p = planFromDays([{ title: "Upper", exercises: [{ exercise_id: EX, sets: 3, reps: "5", rpe: "8" }] }], 4);
    expect(totalWeeks(p)).toBe(4);
    expect(p.blocks[0].weeks[3].days[0].exercises[0]).toMatchObject({ exercise_id: EX, reps: "5", rpe: "8" });
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan({ blocks: [{ weeks: [] }] })).toBeNull();
    const n = normalizePlan(planPayload(p), { [EX]: { name: "Bench" } })!;
    expect(n.blocks[0].weeks[0].days[0].exercises[0].name).toBe("Bench");
    expect(samePlan(n, p)).toBe(true);
  });
});

describe("the database reads the plan the same way", () => {
  const sql = readFileSync("supabase/migrations/20270417090000_member_programs_blocks_weeks.sql", "utf8");
  it("checks a plan like planIssue, and keeps week 1 as the days older apps read", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.athlete_program_clean_plan(_plan jsonb)");
    expect(sql).toContain("RAISE EXCEPTION 'A program has at most 24 weeks'");
    expect(sql).toContain("v_days := public.athlete_program_plan_first_days(v_plan);");
    expect(sql).toContain("ADD CONSTRAINT athlete_programs_weeks_check CHECK (weeks BETWEEN 1 AND 24);");
  });
  it("an older app's save never flattens a program that has a plan", () => {
    expect(sql).toContain("IF _id IS NOT NULL AND EXISTS (SELECT 1 FROM public.athlete_programs WHERE id = _id AND plan IS NOT NULL) THEN");
  });
  it("starting writes a block per block under one program, each week its own days", () => {
    expect(sql).toContain("INSERT INTO public.pl_preps (client_id, title, status, client_visible, start_date, end_date, total_weeks, created_by)");
    // a block's end date: date + count(*) (bigint) has no operator, so every Start failed until it was cast
    expect(sql).toContain("v_bstart + (count(*)::int * 7 - 1)");
    expect(sql).not.toMatch(/v_bstart \+ \(count\(\*\) \*/);
    expect(sql).toContain("CASE WHEN v_cur = 1 THEN 'Active' ELSE 'Draft' END");
    expect(sql).toContain("PERFORM public.athlete_program_insert_rows(v_day, d->'exercises');");
    // a fixed weight lives in its own unit's column; a % carries its basis
    expect(sql).toContain("CASE WHEN v_unit = 'kg' THEN v_load END, CASE WHEN v_unit = 'lb' THEN v_load END, v_unit,");
    expect(sql).toContain("CASE WHEN e->>'pct_of' = 'top_set' THEN 'top_set' ELSE '1rm' END");
  });
  it("a running copy follows edits week by week and never touches a workout with history", () => {
    expect(sql).toContain("IF public.pl_day_touched(dy.id, dy.scheduled_date, v_today) THEN");
    expect(sql).toContain("row_number() OVER (ORDER BY array_position(v_blocks, w.block_id), w.week_index)::int AS g");
    expect(sql).toContain("DELETE FROM public.pl_exercise_rows WHERE day_id = dy.id AND cardio_target_id IS NULL;");
  });
});
