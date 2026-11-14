import { describe, expect, it } from "vitest";
import { effortRange, planCheck, setGuidance, type SetGuidanceInput } from "@/lib/workouts/plan-vs-actual";

const base = (o: Partial<SetGuidanceInput>): SetGuidanceInput => ({
  reps: { exact: 4 }, effort: { min: 6, max: 6 }, sets: [], openSets: 0, backoffsFollow: false,
  unit: "lb", step: 5, coachLoad: false, suggested: null, ...o,
});

describe("effort targets", () => {
  it("reads RPE and RIR prescriptions as an RPE range", () => {
    expect(effortRange("7-8")).toEqual({ min: 7, max: 8 });
    expect(effortRange("@8")).toEqual({ min: 8, max: 8 });
    expect(effortRange("RPE 6")).toEqual({ min: 6, max: 6 });
    expect(effortRange(null, "1-2")).toEqual({ min: 8, max: 9 });
    expect(effortRange("", "")).toBeNull();
    expect(effortRange("hard")).toBeNull();
  });
});

describe("in the logger: a line only when it changes what comes next", () => {
  it("495 × 4 @ 10 on a 4 @ 6 prescription with a set left: the next set's weight", () => {
    const g = setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 10 }], openSets: 2 }))!;
    expect(g.kind).toBe("harder");
    expect(g.next).toBe(435); // the RPE chart: 4 @ 10 → 4 @ 6, rounded down a plate step
    expect(g.text).toBe("RPE 10, planned 6 · next set ~435 lb");
  });

  it("uses the logger's own number so two never disagree, and steps aside when the Suggest card is showing it", () => {
    expect(setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 10 }], openSets: 2, suggested: 425 }))!.next).toBe(425);
    expect(setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 10 }], openSets: 2, suggested: 425, suggestionShown: true }))).toBeNull();
  });

  it("the only working set: nothing to change says nothing; back-offs on a later card are told to go lighter", () => {
    expect(setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 10 }] }))).toBeNull();
    const top = setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 10 }], backoffsFollow: true, suggestionShown: true }))!;
    expect(top.text).toBe("RPE 10, planned 6 · go lighter on the back-offs");
  });

  it("normal RPE noise says nothing (one point over, or on target)", () => {
    expect(setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 7 }], openSets: 1 }))).toBeNull();
    expect(setGuidance(base({ effort: { min: 7, max: 8 }, sets: [{ set: 1, load: 300, reps: 4, rpe: 9 }], openSets: 1 }))).toBeNull();
  });

  it("only the latest set counts: a hard first set followed by one on target is fine", () => {
    expect(setGuidance(base({ sets: [{ set: 1, load: 495, reps: 4, rpe: 10 }, { set: 2, load: 440, reps: 4, rpe: 6 }], openSets: 1 }))).toBeNull();
  });

  it("short of the reps: a lighter next set, never heavier than what was just missed", () => {
    const g = setGuidance(base({ reps: { exact: 5 }, effort: { min: 8, max: 8 }, sets: [{ set: 2, load: 315, reps: 3, rpe: null }], openSets: 1 }))!;
    expect(g.kind).toBe("short");
    expect(g.text.startsWith("3 of 5 reps · next set ~")).toBe(true);
    expect(g.next!).toBeLessThan(315);
  });

  it("easier than planned: room to add a little, capped and never past the RPE target", () => {
    const g = setGuidance(base({ reps: { exact: 8 }, effort: { min: 7, max: 8 }, sets: [{ set: 1, load: 200, reps: 8, rpe: 5 }], openSets: 2 }))!;
    expect(g.kind).toBe("easier");
    expect(g.next!).toBeGreaterThan(200);
    expect(g.next!).toBeLessThanOrEqual(220); // at most +10%
    expect(g.text).toBe(`RPE 5, planned 7-8 · up to ~${g.next} lb next set`);
  });

  it("an easy set says nothing under the coach's weight, with nothing left, or with no weight to add", () => {
    const easy = { reps: { exact: 3 }, effort: { min: 7, max: 8 }, sets: [{ set: 1, load: 405, reps: 3, rpe: 5 }] };
    expect(setGuidance(base({ ...easy, coachLoad: true, openSets: 2 }))).toBeNull();
    expect(setGuidance(base({ ...easy, backoffsFollow: true }))).toBeNull();
    expect(setGuidance(base({ ...easy, sets: [{ set: 1, load: null, reps: 3, rpe: 5 }], openSets: 2 }))).toBeNull();
  });

  it("no effort target and reps hit: nothing to say", () => {
    expect(setGuidance(base({ effort: null, sets: [{ set: 1, load: 100, reps: 4, rpe: 10 }], openSets: 1 }))).toBeNull();
  });

  it("a bodyweight set gets the advice without a weight", () => {
    const g = setGuidance(base({ reps: { exact: 10 }, effort: { min: 7, max: 7 }, sets: [{ set: 1, load: null, reps: 10, rpe: 10 }], openSets: 1 }))!;
    expect(g.text).toBe("RPE 10, planned 7 · ease off next set");
  });
});

describe("the recap's check against the plan", () => {
  const row = (id: string, name: string, sets: number, reps: string, rpe: string | null) => ({ id, sets, reps_text: reps, rpe, exercises: { name } });
  const set = (row_id: string, set_index: number, reps: number, rpe: number | null, warm = false) => ({
    row_id, set_index, actual_reps: reps, actual_rpe: rpe, completed_at: "2026-11-14T18:00:00Z", is_working_set: !warm,
  });

  it("everything as prescribed reads as done as planned", () => {
    const c = planCheck([row("a", "Bench Press", 2, "5", "7"), row("b", "Row", 1, "8-10", "8")], [set("a", 1, 5, 7), set("a", 2, 5, 7.5), set("b", 1, 9, 8)]);
    expect(c.asPlanned).toBe(true);
    expect(c.setsDone).toBe(3);
    expect(c.lines).toEqual([]);
    expect(c.next).toBeNull();
    expect(c.checked).toEqual({ reps: true, effort: true });
  });

  it("names what strayed, harder first, and one line for next time", () => {
    const c = planCheck(
      [row("a", "Competition Deadlift", 1, "4", "6"), row("b", "Romanian Deadlift", 3, "8", "7"), row("c", "Leg Curl", 3, "10-12", "8"), row("d", "Calf Raise", 2, "12", "8")],
      [set("a", 1, 4, 10), set("b", 1, 8, 7), set("b", 2, 6, 9), set("c", 1, 12, 5), set("c", 2, 12, 5), set("c", 3, 12, 6)],
    );
    expect(c.asPlanned).toBe(false);
    expect(c.notLogged).toBe(1); // calf raises: not logged, never "missed"
    expect(c.lines.map((l) => l.kind)).toEqual(["harder", "short", "fewer", "easier"]);
    expect(c.lines[0].text).toBe("Competition Deadlift: RPE 10, planned 6");
    expect(c.lines[1].text).toBe("Romanian Deadlift: reps short on 1 of 2 sets (6 vs 8)");
    expect(c.lines[2].text).toBe("Romanian Deadlift: 2 of 3 sets");
    expect(c.next).toBe("Next time, start Competition Deadlift a little lighter.");
  });

  it("warm-ups never count, extra sets are said, and timed rows only count sets", () => {
    const c = planCheck(
      [row("a", "Squat", 2, "5", "8"), { id: "w", sets: 1, reps_text: "10:00", rpe: "6", measurement_type: "time", exercises: { name: "Treadmill Walk" } }],
      [set("a", 1, 5, 2, true), set("a", 1, 5, 8), set("a", 2, 5, 8), set("a", 3, 5, 8), { row_id: "w", set_index: 1, actual_reps: null, completed_duration_seconds: 600, actual_rpe: 3, completed_at: "x" }],
    );
    expect(c.lines.map((l) => l.text)).toEqual(["Squat: 3 sets, 2 planned"]);
  });
});

describe("one exercise over two cards", () => {
  it("a top set and its back-offs that both ran hot are said once", () => {
    const rows = [{ id: "t", sets: 1, reps_text: "5", rpe: "7", exercises: { name: "Back Squat" } }, { id: "b", sets: 2, reps_text: "5", rpe: "6", exercises: { name: "Back Squat" } }];
    const done = (row_id: string, i: number) => ({ row_id, set_index: i, actual_reps: 5, actual_rpe: 10, completed_at: "x" });
    const c = planCheck(rows, [done("t", 1), done("b", 1), done("b", 2)]);
    expect(c.lines).toEqual([{ kind: "harder", name: "Back Squat", text: "Back Squat: RPE 10, planned 7" }]);
    expect(c.next).toBe("Next time, start Back Squat a little lighter.");
  });
});
