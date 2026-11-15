import { describe, expect, it } from "vitest";
import { rowProblems, validateDay } from "@/lib/pl-template-validation";
import {
  buildProgramGaps, estimatedMaxPlan, fillInstruction, FILL_MAX, gapBriefLines, gapDetail, gapParts, gapsToAlert, gapTagLabel, rpeCapFor, whenLabel,
  type ProgramGapsData,
} from "@/lib/program-gaps";
import { matchesSignal, signalTags, waitingCount, briefWaitingLines, type ClientSignals } from "@/lib/inbox-brief";
import { computeWeeklyVolume, variationTypeOf } from "@/lib/volume";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1", day_id: "d1", sort_order: 0, exercise_id: "ex", exercise: "Leg Curl", exercise_name_override: null,
  sets: 2, reps_text: "8", rpe: null, rir: null, percentage: null, percentage_basis: null, load_kg: null, load_lb: null,
  measurement_type: "reps", duration_seconds: null, movement_family: null, competition_lift_type: null, exercise_family: null,
  ...over,
});

describe("rowProblems: what an athlete can't follow yet", () => {
  it("a timed row is prescribed by its time (a treadmill walk never needs an RPE)", () => {
    expect(rowProblems(row({ measurement_type: "time", duration_seconds: 1500, reps_text: null }))).toEqual([]);
    expect(rowProblems(row({ measurement_type: "time", duration_seconds: null, reps_text: "5 km" }))).toEqual([]);
    expect(rowProblems(row({ measurement_type: "time", duration_seconds: null, reps_text: null }))).toEqual(["duration"]);
  });
  it("needs an RPE, RIR, weight or a % the app can read", () => {
    expect(rowProblems(row())).toEqual(["intensity"]);
    expect(rowProblems(row({ rir: "4" }))).toEqual([]);
    expect(rowProblems(row({ percentage: 88, percentage_basis: "top_set" }))).toEqual([]);
    expect(rowProblems(row({ percentage: 75, percentage_basis: "est_1rm" }))).toEqual([]);
    expect(rowProblems(row({ load_kg: 60 }))).toEqual([]);
  });
  it("a 'manual' % with no weight says what's missing, unless an RPE covers it", () => {
    expect(rowProblems(row({ percentage: 75, percentage_basis: "manual" }))).toEqual(["percent"]);
    expect(rowProblems(row({ percentage: 75, percentage_basis: "manual", rpe: "6" }))).toEqual([]);
  });
  it("the builder's day banner reads the same rule", () => {
    expect(validateDay({ rows: [row({ rir: "3" }), row({ id: "w", exercise_name_override: "Treadmill Walk", measurement_type: "time", duration_seconds: 900, reps_text: null })] })).toEqual([]);
    expect(validateDay({ rows: [row({ exercise_name_override: "Lying Hamstring Curl" })] })).toEqual(["Lying Hamstring Curl: missing RPE, RIR, or suggested load"]);
  });
});

const data = (): ProgramGapsData => ({
  clients: [
    { id: "a", name: "Alyssa Burg", first_name: "Alyssa", photo: null, training_days: ["Monday"], today: "2026-11-15", no_training_days: false },
    { id: "b", name: "Bea Later", first_name: "Bea", photo: null, training_days: [], today: "2026-11-15", no_training_days: true },
    { id: "c", name: "Cal Fine", first_name: "Cal", photo: null, training_days: ["Monday"], today: "2026-11-15", no_training_days: false },
  ],
  blocks: [
    { id: "b3", client_id: "a", name: "Block 3 — Peak", start_date: "2026-11-09" },
    { id: "bb", client_id: "b", name: "Base", start_date: "2026-11-30" },
    { id: "bc", client_id: "c", name: "Hybrid", start_date: "2026-11-09" },
  ],
  days: [
    { id: "d1", block_id: "b3", client_id: "a", week_index: 2, day_index: 1, title: "Monday", date: "2026-11-16", optional: false },
    { id: "d2", block_id: "b3", client_id: "a", week_index: 2, day_index: 2, title: "Wednesday", date: "2026-11-18", optional: false },
    { id: "u1", block_id: "bb", client_id: "b", week_index: 1, day_index: 1, title: null, date: null, optional: false },
    { id: "c1", block_id: "bc", client_id: "c", week_index: 1, day_index: 1, title: "Heavy", date: "2026-11-16", optional: false },
  ],
  rows: [
    row({ id: "leg", day_id: "d1", sort_order: 3 }),
    row({ id: "sq", day_id: "d1", sort_order: 0, exercise: "Competition Squat", percentage: 82, percentage_basis: "1rm", competition_lift_type: "squat" }),
    row({ id: "ps", day_id: "d2", sort_order: 0, exercise: "2-Count Paused Squat", percentage: 60, percentage_basis: "1rm", rpe: "6", exercise_family: "squat" }),
    // a training max is on file for Cal's competition squat: his High Bar Squat reads it
    row({ id: "hb", day_id: "c1", exercise: "High Bar Squat", percentage: 65, percentage_basis: "training_max", rpe: "6", exercise_family: "squat" }),
  ],
  maxes: [
    { id: "m1", client_id: "c", lift: "Competition Squat", training_max: 235, one_rm: null, estimated_1rm: null, unit: "kg", active: true, block_id: "bc" } as any,
    // another block's max never counts for this one
    { id: "m2", client_id: "a", lift: "Competition Squat", training_max: null, one_rm: 180, estimated_1rm: null, unit: "kg", active: true, block_id: "other" } as any,
  ],
});

describe("buildProgramGaps", () => {
  const gaps = buildProgramGaps(data());
  const a = gaps.find((g) => g.clientId === "a")!;
  const b = gaps.find((g) => g.clientId === "b")!;

  it("lists only clients with something missing, most urgent first", () => {
    expect(gaps.map((g) => g.clientId)).toEqual(["a", "b"]);
    expect(gaps.some((g) => g.clientId === "c")).toBe(false);
  });
  it("a workout's rows missing a prescription, by date", () => {
    expect(a.workouts.map((w) => [w.dayId, w.items.map((i) => [i.exercise, i.problems])])).toEqual([
      ["d1", [["Leg Curl", ["intensity"]]]],
    ]);
    expect(a.firstDate).toBe("2026-11-16");
    expect(a.dueSoon).toBe(true);
  });
  it("a % of a 1RM nobody entered is one gap per lift, with the sets that show nothing", () => {
    expect(a.maxes).toEqual([
      {
        basis: "1rm", lift: "Squat", exercises: ["Competition Squat", "2-Count Paused Squat"], rows: 2, firstDate: "2026-11-16", nothingElse: 1,
        rowRefs: [
          { id: "sq", percentage: 82, reps: "8", hasEffort: false },
          { id: "ps", percentage: 60, reps: "8", hasEffort: true },
        ],
      },
    ]);
  });
  it("undated workouts and no training days are gaps too", () => {
    expect(b.undated).toEqual([{ blockId: "bb", blockName: "Base", count: 1 }]);
    expect(b.noTrainingDays).toBe(true);
    expect(b.count).toBe(2);
  });
  it("says it in words", () => {
    expect(gapParts(a)).toEqual(["1 workout missing a prescription", "1RM for Squat not on file"]);
    expect(gapTagLabel(a)).toBe("1 workout missing a prescription +1");
    expect(gapDetail(a)).toBe("from Mon, Nov 16 · 1 workout missing a prescription · 1RM for Squat not on file");
    expect(gapParts(b, { schedule: false })).toEqual([]);
    expect(gapBriefLines(a)[0]).toContain("2026-11-16");
    expect(whenLabel("2026-11-15", "2026-11-16")).toBe("Tomorrow");
    expect(whenLabel("2026-11-15", "2026-11-20")).toBe("In 5 days");
    expect(whenLabel("2026-11-15", "2026-12-12")).toBe("Sat, Dec 12");
  });
  it("Fill in with AI asks for exactly what's missing, inside the AI's limit", () => {
    const text = fillInstruction(a);
    expect(text).toContain("change nothing else");
    expect(text).toContain("Leg Curl (missing RPE, RIR, or suggested load)");
    expect(text).toContain("don't invent one");
    const big = { ...a, workouts: Array.from({ length: 200 }, (_, i) => ({ ...a.workouts[0], dayId: `x${i}` })) };
    expect(fillInstruction(big).length).toBeLessThanOrEqual(FILL_MAX);
    expect(fillInstruction(big)).toContain("more like these");
  });
});

describe("Messages: Program data", () => {
  const base: ClientSignals = { needsReply: null, toReview: [], overdue: [], pending: [], missed: 0, media: [], pain: [], sessionRequests: 0 };
  const a = buildProgramGaps(data()).find((g) => g.clientId === "a")!;
  it("is a filter, a line on the row and one thing waiting", () => {
    expect(matchesSignal(base, "Program")).toBe(false);
    expect(matchesSignal({ ...base, program: a }, "Program")).toBe(true);
    expect(signalTags({ ...base, program: a })).toEqual([{ key: "program", label: "1 workout missing a prescription +1", tone: "warn" }]);
    expect(signalTags({ ...base, program: { ...a, dueSoon: false } })[0].tone).toBe("info");
    expect(waitingCount({ ...base, program: a })).toBe(1);
    expect(briefWaitingLines({ ...base, program: a }).some((l) => l.startsWith("Program:"))).toBe(true);
  });
});

describe("volume: effective sets without a variation tag", () => {
  it("reads the library's own fields", () => {
    expect(variationTypeOf({ id: "s", competition_lift_type: "squat" })).toBe("competition");
    expect(variationTypeOf({ id: "p", movement_family: "bench" })).toBe("close_variation");
    expect(variationTypeOf({ id: "c", primary_movement_pattern: "hamstring_curl" })).toBe("isolation");
    expect(variationTypeOf({ id: "r", primary_movement_pattern: "horizontal_pull" })).toBe("secondary_compound");
    expect(variationTypeOf({ id: "w", primary_movement_pattern: "conditioning" })).toBe("conditioning");
    expect(variationTypeOf({ id: "t", variation_type: "rehab", competition_lift_type: "squat" })).toBe("rehab");
  });
  it("a week of untagged library exercises no longer reads 0 effective", () => {
    const v = computeWeeklyVolume(
      { days: [{ rows: [{ exercise_id: "sq", sets: 3 }, { exercise_id: "curl", sets: 2 }, { exercise_id: "walk", sets: 1 }] }] },
      [
        { id: "sq", competition_lift_type: "squat", primary_movement_pattern: "squat" },
        { id: "curl", primary_movement_pattern: "hamstring_curl" },
        { id: "walk", primary_movement_pattern: "conditioning" },
      ],
    );
    expect(v.totalRawSets).toBe(6);
    expect(v.totalEffectiveSets).toBeCloseTo(3 * 1 + 2 * 0.4 + 0, 5);
  });
});

describe("keeping it from happening again", () => {
  it("the morning push: a gap on a workout in the next 3 days, once a client a day", () => {
    const gaps = buildProgramGaps(data());
    expect(gapsToAlert(gaps)).toEqual([{ clientId: "a", sourceId: "2026-11-15:2026-11-16" }]);
    const later = gaps.map((g) => ({ ...g, firstDate: "2026-11-25" }));
    expect(gapsToAlert(later)).toEqual([]);
  });
  it("two live programs on the same days are a gap (a replaced program never ended)", () => {
    const d = data();
    d.blocks.push({ id: "old", client_id: "c", name: "Old Peak", start_date: "2026-11-02" });
    d.doubled = [
      { client_id: "c", date: "2026-11-18", block_ids: ["bc", "old"] },
      { client_id: "c", date: "2026-11-16", block_ids: ["bc", "old"] },
    ];
    const c = buildProgramGaps(d).find((g) => g.clientId === "c")!;
    expect(c.doubled).toEqual({ blockNames: ["Hybrid", "Old Peak"], days: 2, firstDate: "2026-11-16" });
    expect(gapParts(c)).toEqual(["Two programs on 2 days"]);
    expect(gapParts(c, { schedule: false })).toEqual([]);
  });
  it("Use estimated max keeps each %, capping only the sets with nothing to go by", () => {
    expect(rpeCapFor(82, "2")).toBe("7");
    expect(rpeCapFor(57.5, "1")).toBe("5");
    expect(Number(rpeCapFor(95, "1"))).toBeGreaterThanOrEqual(9);
    const a = buildProgramGaps(data()).find((g) => g.clientId === "a")!;
    expect(estimatedMaxPlan(a.maxes)).toEqual([{ id: "sq", rpe: rpeCapFor(82, "8") }, { id: "ps", rpe: null }]);
  });
});
