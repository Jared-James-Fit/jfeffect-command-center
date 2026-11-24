import { describe, expect, it } from "vitest";
import { applyPatches, completenessWord, programCheck, programCompleteness, suggestDayName, type CheckExercise, type CheckInput } from "@/lib/program-check";
import { blockTypeLine, blockTypeLibrary, inferBlockType, resolveBlockType } from "@/lib/block-types";
import { sessionLimit } from "@/lib/program-intel/session-limit";

const EX: CheckExercise[] = [
  { id: "sq", name: "Competition Squat", is_competition_lift: true, competition_lift_type: "squat", exercise_category: "compound", equipment: "Barbell", video_url: "v" },
  { id: "bp", name: "Competition Bench", is_competition_lift: true, competition_lift_type: "bench", exercise_category: "compound", equipment: "Barbell", video_url: "v" },
  { id: "dl", name: "Competition Deadlift", is_competition_lift: true, competition_lift_type: "deadlift", exercise_category: "compound", equipment: "Barbell", video_url: "v" },
  { id: "lp", name: "Lat Pulldown", exercise_category: "compound", equipment: "Cable", video_url: "v" },
  { id: "db", name: "Dumbbell Lateral Raise", exercise_category: "isolation", equipment: "Dumbbell", video_url: "v" },
  { id: "cp", name: "Cable Triceps Pushdown", exercise_category: "isolation", equipment: "Cable", video_url: "v" },
  { id: "ohp", name: "Overhead Press", exercise_category: "compound", equipment: "Barbell", video_url: "v" },
];
const exMap = new Map(EX.map((e) => [e.id, e]));

const row = (exercise_id: string, extra: Record<string, unknown> = {}) => ({ exercise_id, sets: 3, reps_text: "5", rpe: "7", ...extra });

function program(): CheckInput {
  const week = (n: number) => ({
    week_index: n,
    days: [
      { day_index: 1, title: "", subtitle: "", scheduled_date: `2026-12-0${n}`, rows: [row("sq", { rpe: String(6 + n) }), row("sq", { percentage: 90, percentage_basis: "top_set", rpe: null }), row("lp", { reps_text: "10" }), row("db", { reps_text: "12", rpe: null }), row("cp", { reps_text: "12" })] },
      { day_index: 2, subtitle: "Bench day", scheduled_date: null, rows: [row("bp"), row("ohp", { notes: "Progress: Double progression. · Start ~135lb" })] },
    ],
  });
  return {
    kind: "client",
    style: "powerlifting",
    blocks: [{ id: "b1", name: "Block 1 — Volume", weeks: [week(1), week(2)], blockType: null, phase: null, trainingFocus: null }],
    exercises: exMap,
    athlete: { sessionLimit: sessionLimit({ goalsMinutes: 60 }), equipment: { items: ["barbell", "rack", "bench", "dumbbells"], confidence: "confirmed" }, hasMax: () => true, needsDates: true },
    locked: (at) => at.week === 0 && at.day === 0,
  };
}

describe("block types", () => {
  it("reads a type from a block's own words, and says so", () => {
    expect(inferBlockType({ name: "Block 1 — Volume" })).toBe("accumulation");
    expect(inferBlockType({ name: "Commonwealth Peak" })).toBe("peaking");
    expect(inferBlockType({ name: "Glute Focus Hypertrophy" })).toBe("hypertrophy");
    expect(inferBlockType({ phase: "Deload", name: "Week off" })).toBe("deload");
    expect(inferBlockType({ name: "Block 3" })).toBeNull();
    const r = resolveBlockType({ name: "Block 1 — Volume" });
    expect(r.inferred).toBe(true);
    expect(r.type?.name).toBe("Accumulation");
  });

  it("a coach's rename and colour apply; a custom type reads like the one it's based on", () => {
    const lib = blockTypeLibrary([
      { id: "x", builtin_key: "strength", name: "Strength A", color: "teal" },
      { id: "c1", name: "Strength-Speed", color: "cyan", based_on: "intensification" },
    ]);
    const s = lib.find((t) => t.key === "strength")!;
    expect(s.name).toBe("Strength A");
    expect(s.color).toBe("teal");
    const c = lib.find((t) => t.key === "c1")!;
    expect(c.basedOn).toBe("intensification");
    expect(c.intensity).toBe("very_high");
    const line = blockTypeLine(resolveBlockType({ block_type: "c1", block_meta: { purpose: "Bar speed at 70–80%" } }, lib))!;
    expect(line).toContain("Strength-Speed (coach's own type, built on Intensification)");
    expect(line).toContain("purpose: Bar speed at 70–80%");
    expect(line).not.toContain("cyan");
  });
});

describe("completeness", () => {
  it("scores what's filled in and points at what isn't", () => {
    const c = programCompleteness(program());
    expect(c.score).toBeGreaterThan(40);
    expect(c.score).toBeLessThan(100);
    const presc = c.items.find((i) => i.key === "prescriptions")!;
    // the lateral raises have no RPE, RIR or weight (2 weeks)
    expect(presc.gaps.length).toBe(2);
    expect(presc.gaps[0].at).toEqual({ block: 0, week: 0, day: 0, row: 3 });
    const sched = c.items.find((i) => i.key === "schedule")!;
    expect(sched.gaps.map((g) => g.at)).toEqual([{ block: 0, week: 0, day: 1 }, { block: 0, week: 1, day: 1 }]);
    // a powerlifting program with no deadlift
    expect(c.items.find((i) => i.key === "competition")!.gaps[0].text).toContain("deadlift");
    expect(completenessWord(c.score)).not.toBe("Complete");
  });

  it("never asks a bodybuilding program for competition lifts or maxes", () => {
    const p = program();
    p.style = "bodybuilding";
    p.kind = "template";
    p.athlete = null;
    const c = programCompleteness(p);
    expect(c.items.some((i) => i.key === "competition")).toBe(false);
    expect(c.items.some((i) => i.key === "maxes" || i.key === "schedule" || i.key === "constraints")).toBe(false);
  });
});

describe("program check", () => {
  it("quick polish only has safe changes, each with its before and after, and never touches a trained workout", () => {
    const f = programCheck(program(), "quick");
    expect(f.every((x) => x.level === "safe")).toBe(true);
    const labels = f.find((x) => x.id === "safe:backoff-labels")!;
    // week 1 day 1 is locked: only week 2's back-off
    expect(labels.patches).toHaveLength(1);
    expect(labels.changes![0]).toMatchObject({ before: "No label", after: "Back-off" });
    const names = f.find((x) => x.id === "safe:day-names")!;
    expect(names.changes!.map((c) => c.after)).toEqual(["Squat"]);
    const notes = f.find((x) => x.id === "safe:notes")!;
    expect(notes.changes!.every((c) => !/135lb/.test(c.after))).toBe(true);
  });

  it("applies only what was picked", () => {
    const p = program();
    const f = programCheck(p, "quick");
    const picked = f.filter((x) => x.id === "safe:backoff-labels").flatMap((x) => x.patches ?? []);
    const [after] = applyPatches([p.blocks[0].weeks], picked);
    expect(after[1].days[0].rows[1].purpose_label).toBe("Back-off");
    // untouched week stays the same object
    expect(after[0]).toBe(p.blocks[0].weeks[0]);
    expect(p.blocks[0].weeks[1].days![0].rows![1].purpose_label).toBeUndefined();
  });

  it("a deep review asks the coach about anything that changes the training", () => {
    const f = programCheck(program(), "deep");
    const intensity = f.find((x) => x.id === "decision:intensity")!;
    expect(intensity.level).toBe("decision");
    expect(intensity.ask).toContain("Dumbbell Lateral Raise");
    expect(f.filter((x) => x.level === "safe").every((x) => (x.patches ?? []).length > 0)).toBe(true);
    // decisions never carry patches: nothing changes without the coach
    expect(f.filter((x) => x.level !== "safe").some((x) => x.patches?.length)).toBe(false);
  });

  it("names a workout from its main lifts", () => {
    expect(suggestDayName([row("sq"), row("bp")], exMap)).toBe("Squat + Bench");
    expect(suggestDayName([row("lp"), row("lp")], exMap)).toBe("Pull");
  });

  it("warns when pain is on an area the program loads", () => {
    const p = program();
    p.athlete!.pain = [{ key: "shoulder", label: "Shoulder", sides: ["L"], reports: 3, days: 3, first: "2026-10-01", last: "2026-11-01", worst: 6, trend: "worse", evidence: [] }];
    const f = programCheck(p, "deep");
    const w = f.find((x) => x.id === "warning:pain:shoulder")!;
    expect(w.level).toBe("warning");
    expect(w.detail).toMatch(/Bench|Overhead Press|Lateral Raise/);
  });
});

describe("a block's type is read from its sets, not its words alone (Nov 24 2026)", () => {
  const rows = (reps: string, n: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: n }, () => ({ sets: 3, reps_text: reps, rpe: "8", ...extra }));
  it("a Powerbuilding block of 8–12 rep sets is hypertrophy, never Peaking", async () => {
    const { blockEvidence, inferBlockType } = await import("@/lib/block-types");
    const evidence = blockEvidence([...rows("8-12", 10), ...rows("5", 2, { time_profile: "main_lift" })], 4);
    expect(inferBlockType({ name: "Powerbuilding", training_focus: "Peak", evidence })).toBe("hypertrophy");
    expect(inferBlockType({ name: "Powerbuilding", training_focus: "Competition lifts + hypertrophy" })).toBe("hypertrophy");
    expect(inferBlockType({ name: "Powerbuilding" })).toBeNull();
  });
  it("a heavy singles block reads as intensification, and peaking only with a meet close", async () => {
    const { blockEvidence, inferBlockType } = await import("@/lib/block-types");
    const evidence = blockEvidence(rows("1-2", 8, { time_profile: "main_lift", rpe: "9" }), 3);
    expect(inferBlockType({ name: "Block 4", evidence })).toBe("intensification");
    expect(inferBlockType({ name: "Block 4", evidence, meetWithinWeeks: 3 })).toBe("peaking");
    expect(inferBlockType({ name: "Meet Peak", evidence })).toBe("peaking");
  });
  it("accessories at 8–12 never turn a strength block into hypertrophy", async () => {
    const { blockEvidence, inferBlockType } = await import("@/lib/block-types");
    const evidence = blockEvidence(
      [
        { sets: 1, reps_text: "3", rpe: "8", purpose_label: "Top set" },
        { sets: 3, reps_text: "5", purpose_label: "Back-off" },
        { sets: 1, reps_text: "3", rpe: "8", purpose_label: "Top set" },
        { sets: 3, reps_text: "5", purpose_label: "Back-off" },
        ...rows("8-12", 6),
      ],
      4,
    );
    expect(inferBlockType({ name: "Strength", evidence })).toBe("strength");
    expect(inferBlockType({ name: "Block 2", evidence })).toBe("strength");
  });
  it("a coach's Peak of heavy triples stays a peak", async () => {
    const { blockEvidence, inferBlockType } = await import("@/lib/block-types");
    const evidence = blockEvidence(rows("3", 6, { purpose_label: "Top set", rpe: "8" }), 4);
    expect(inferBlockType({ name: "Peak", evidence })).toBe("peaking");
  });
  it("a name the sets agree with wins; one workout says nothing", async () => {
    const { blockEvidence, inferBlockType } = await import("@/lib/block-types");
    expect(inferBlockType({ name: "Volume", evidence: blockEvidence(rows("8", 10), 4) })).toBe("accumulation");
    expect(inferBlockType({ name: "Block 2", evidence: blockEvidence(rows("10", 2), 1) })).toBeNull();
  });
  it("reads a template's weeks of days of rows", async () => {
    const { inferBlockType } = await import("@/lib/block-types");
    const weeks = Array.from({ length: 4 }, () => ({ days: [{ rows: rows("10-12", 4) }] }));
    expect(inferBlockType({ name: "Phase 1", weeks })).toBe("hypertrophy");
  });
});
