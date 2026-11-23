import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  blockStrengthRows,
  blockVolumeRows,
  cardioNoteForAthlete,
  cardioTargetsView,
  changeWords,
  consistencyOf,
  liftSeries,
  liftsTrending,
  maxesFromRows,
  niceDomain,
  normalizedSeries,
  progressSnapshot,
  snapshotLift,
  strengthMinSpan,
  testedNotMeet,
} from "@/lib/analytics/analytics-areas";
import type { StrengthPoint } from "@/lib/analytics/competition-strength";
import { comparableE1rm, strengthTrend } from "@/lib/analytics/strength-read";
import { buildTrainingLoad, type LoadSet, type PlanRow } from "@/lib/analytics/training-load";
import { compLiftFromName } from "@/lib/analytics/sbd-split";

// The second Workouts / analytics pass (Nov 22 2026): one lift on its own axis,
// lines that break at gaps, axes that never zoom past what a change can mean,
// every change measured from a stated day, the four kinds of max kept apart,
// a Consistency area, and a dashboard snapshot that says what each number is.

const pt = (lift: StrengthPoint["lift"], day: string, e1rm: number): StrengthPoint => ({
  lift,
  day,
  e1rm,
  set: { load: Math.round(e1rm * 0.85), reps: 5, effort: 8 },
});
const read = (p: string) => readFileSync(p, "utf8");

describe("one lift over time", () => {
  it("breaks the line where hard sets are too far apart to be one trend", () => {
    const pts = [
      pt("squat", "2026-08-01", 500),
      pt("squat", "2026-08-08", 505),
      pt("squat", "2026-10-01", 520),
      pt("bench", "2026-08-02", 300),
    ];
    const s = liftSeries(pts, "squat", "2026-07-01", "2026-10-31", "session");
    expect(s.map((p) => p.value)).toEqual([500, 505, null, 520]);
    // the break sits between the two observations it separates
    expect(s[2].t).toBeGreaterThan(s[1].t);
    expect(s[2].t).toBeLessThan(s[3].t);
  });

  it("never zooms an axis in past a change worth drawing (a 1 lb dip on 308–312 read as a crash)", () => {
    const vals = [308, 309, 309, 308];
    const span = strengthMinSpan(vals);
    expect(span).toBeGreaterThanOrEqual(18);
    const { domain, ticks } = niceDomain(vals, { minSpan: span, floor: 0 });
    expect(domain[1] - domain[0]).toBeGreaterThanOrEqual(span);
    expect(domain[0]).toBeLessThanOrEqual(308);
    expect(domain[1]).toBeGreaterThanOrEqual(309);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    // round ticks
    for (const t of ticks) expect(Math.abs(t - Math.round(t))).toBeLessThan(1e-9);
    // a wide spread keeps its own range
    const wide = niceDomain([400, 560], { minSpan: 20 });
    expect(wide.domain[0]).toBeLessThanOrEqual(400);
    expect(wide.domain[1]).toBeGreaterThanOrEqual(560);
  });

  it("says every change against a stated day", () => {
    const t = strengthTrend([
      { date: "2026-08-31", value: 520 },
      { date: "2026-09-10", value: 522 },
      { date: "2026-09-20", value: 528 },
      { date: "2026-10-01", value: 531 },
      { date: "2026-10-12", value: 536 },
      { date: "2026-10-25", value: 540 },
    ]);
    expect(t.kind).toBe("up");
    if (t.kind === "unclear") throw new Error("unreachable");
    // measured from the best of the first few sessions, and that session's day is the one said
    expect(t.firstDate).toBe("2026-09-10");
    expect(t.lastDate).toBe("2026-10-25");
    const w = changeWords(
      t,
      (x) => x,
      "lb",
      (d) => (d === "2026-09-10" ? "Sep 10" : d),
    );
    expect(w).toEqual({ text: "+18 lb since Sep 10", tone: "up" });
    const few = changeWords(
      strengthTrend([{ date: "2026-10-01", value: 500 }]),
      (x) => x,
      "lb",
      (d) => d,
    );
    expect(few.tone).toBe("none");
    expect(few.text).toMatch(/RPE 7\+/);
  });

  it("compares lifts only as % change, each from its own first hard set in the period", () => {
    const pts = [
      pt("squat", "2026-09-01", 500),
      pt("squat", "2026-10-01", 525),
      pt("bench", "2026-09-03", 300),
      pt("bench", "2026-10-03", 303),
      pt("deadlift", "2026-09-05", 600), // one point: left out, never a dot at 0%
    ];
    const n = normalizedSeries(pts, "2026-08-25", "2026-10-31", "session");
    expect(n.lifts).toEqual(["squat", "bench"]);
    expect(n.baselines.squat).toEqual({ day: "2026-09-01", value: 500 });
    const last = (l: "squat" | "bench") => [...n.rows].reverse().find((r) => r[l] != null)![l];
    expect(last("squat")).toBe(5);
    expect(last("bench")).toBe(1);
  });
});

describe("blocks", () => {
  const blocks = [
    { id: "b1", name: "Block 1 — Base", start_date: "2026-08-03", end_date: "2026-08-30" },
    { id: "b2", name: "Block 2 — Peak", start_date: "2026-08-31", end_date: "2026-09-20" },
    { id: "b3", name: "Block 3 — Base", start_date: "2026-09-28", end_date: null },
  ];
  it("each block's best estimate by its own dates, and the change from the block before", () => {
    const pts = [
      pt("squat", "2026-08-10", 500),
      pt("squat", "2026-08-24", 510),
      pt("squat", "2026-09-14", 530),
      pt("squat", "2026-10-12", 520),
    ];
    const rows = blockStrengthRows(pts, blocks, "2026-08-01", "2026-11-22");
    expect(rows.map((r) => [r.name, r.phase, r.best.squat?.e1rm, r.vsPrev.squat ?? null])).toEqual([
      ["Base", "Base / volume", 510, null],
      ["Peak", "Peak", 530, 20],
      ["Base", "Base / volume", 520, -10],
    ]);
  });

  it("volume per block reads the weeks its Thursdays fall in, never a week still going", () => {
    const sets: LoadSet[] = [];
    const add = (day: string, n: number) => {
      for (let i = 0; i < n; i++)
        sets.push({
          exerciseId: "e",
          exercise: "Leg Press",
          primary: ["Quads"],
          secondary: [],
          day,
          dayId: day,
          rowId: `${day}-r`,
          reps: 8,
          loadKg: 100,
          rpe: 8,
          rir: null,
        });
    };
    add("2026-08-04", 10);
    add("2026-08-11", 10);
    add("2026-09-01", 20);
    add("2026-11-17", 30); // this week (today Nov 22): not part of an average
    const load = buildTrainingLoad({ sets, today: "2026-11-22" });
    const rows = blockVolumeRows(load.weeks, blocks);
    expect(rows.find((r) => r.id === "b1")?.setsPerWeek).toBe(5); // 20 sets over b1's 4 weeks (2 weeks off count as zero)
    expect(rows.find((r) => r.id === "b2")?.setsPerWeek).toBe(6.7); // 20 sets over b2's 3 weeks
  });
});

describe("maxes on file: four different numbers, never swapped", () => {
  // Jared's real active rows on Nov 22 2026 (pl_client_maxes, read-only)
  const rows = [
    {
      lift: "Competition Bench Press",
      one_rm: "150",
      training_max: "150",
      source: "tested",
      unit: "kg",
      tested_at: "2026-09-20",
      updated_at: "2026-11-16",
    },
    {
      lift: "Competition Bench Press",
      one_rm: "315",
      training_max: null,
      source: "manual",
      unit: "lb",
      tested_at: null,
      updated_at: "2026-10-08",
    },
    {
      lift: "Competition Deadlift",
      one_rm: "600",
      training_max: null,
      source: "manual",
      unit: "lb",
      tested_at: null,
      updated_at: "2026-10-08",
    },
    {
      lift: "Competition Squat",
      one_rm: "235",
      training_max: "235",
      source: "tested",
      unit: "kg",
      tested_at: "2026-09-20",
      updated_at: "2026-11-16",
    },
    {
      lift: "Competition Squat",
      one_rm: null,
      training_max: "500",
      source: "manual",
      unit: "lb",
      tested_at: null,
      updated_at: "2026-06-09",
    },
    {
      lift: "High Bar Squat",
      one_rm: null,
      training_max: null,
      source: "manual",
      unit: "kg",
      tested_at: null,
      updated_at: "2026-11-14",
    },
  ];
  const m = maxesFromRows(rows, compLiftFromName);
  const of = (lift: string, kind: string) => m.find((x) => x.lift === lift && x.kind === kind);
  it("a tested 1RM is tested, with its day", () => {
    expect(Math.round(of("squat", "tested")!.lb)).toBe(518);
    expect(of("squat", "tested")!.date).toBe("2026-09-20");
    expect(Math.round(of("bench", "tested")!.lb)).toBe(331);
  });
  it("a number the coach typed in is 'entered', never a training max (the old card called the 600 deadlift a training max)", () => {
    expect(of("deadlift", "on_file")!.lb).toBe(600);
    expect(of("deadlift", "training_max")).toBeUndefined();
    expect(of("bench", "on_file")!.lb).toBe(315);
  });
  it("the training max is the training_max column, the newest one", () => {
    expect(Math.round(of("squat", "training_max")!.lb)).toBe(518);
    expect(Math.round(of("bench", "training_max")!.lb)).toBe(331);
  });
  it("a tested max that's a meet result isn't marked twice", () => {
    const meets = [
      {
        date: "2026-09-18",
        name: "Commonwealth",
        lifts: { squat: 518.1, bench: 330.7, deadlift: 595.2 },
        total: 1444,
        bodyweightLb: 144,
      },
    ];
    expect(testedNotMeet([of("squat", "tested")!], meets)).toEqual([]);
    expect(
      testedNotMeet([{ lift: "squat", kind: "tested", lb: 540, date: "2026-11-01" }], meets),
    ).toHaveLength(1);
  });
});

describe("consistency", () => {
  it("counts workouts written for days that have passed, week by week, and the last 4 weeks against the 4 before", () => {
    const sets: LoadSet[] = [];
    const plan: PlanRow[] = [];
    // 10 weeks, 3 workouts a week, the first 4 weeks miss one each
    for (let w = 0; w < 10; w++) {
      for (let d = 0; d < 3; d++) {
        const day = new Date(Date.UTC(2026, 8, 7 + w * 7 + d * 2)).toISOString().slice(0, 10);
        const dayId = `d${w}-${d}`;
        plan.push({
          rowId: `${dayId}-r`,
          dayId,
          day,
          sets: 3,
          exerciseId: "e",
          exercise: "Leg Press",
          primary: ["Quads"],
          secondary: [],
        });
        if (w < 4 && d === 2) continue;
        for (let s = 0; s < 3; s++)
          sets.push({
            exerciseId: "e",
            exercise: "Leg Press",
            primary: ["Quads"],
            secondary: [],
            day,
            dayId,
            rowId: `${dayId}-r`,
            reps: 8,
            loadKg: 100,
            rpe: 8,
            rir: null,
          });
      }
    }
    const load = buildTrainingLoad({ sets, plan, today: "2026-11-22" });
    const c = consistencyOf(load);
    expect(c.planned).toBe(30);
    expect(c.done).toBe(26);
    expect(c.pct).toBe(87);
    expect(c.setsPlanned).toBe(90);
    expect(c.setsDone).toBe(78);
    expect(c.weeks).toHaveLength(10);
    expect(c.weeks[0]).toMatchObject({ planned: 3, done: 2 });
    expect(c.recent).toEqual({ pct: 100, weeks: 4 });
  });
});

describe("the Workouts dashboard's progress snapshot", () => {
  const conv = (x: number) => x;
  const fmtDay = (d: string) => (d === "2026-09-07" ? "Sep 7" : d);
  const trend = strengthTrend([
    { date: "2026-09-07", value: 520 },
    { date: "2026-09-20", value: 522 },
    { date: "2026-10-05", value: 530 },
    { date: "2026-10-20", value: 534 },
    { date: "2026-11-10", value: 540 },
  ]);
  it("says what each number is measured against; PRs only when there are some", () => {
    const m = progressSnapshot({
      month: { label: "November", planned: 12, done: 11 },
      strength: { name: "Squat", trend, unit: "lb", conv, fmtDay },
      prs: { count: 0, names: [] },
      setsLastWeek: 40,
    });
    expect(m.map((x) => [x.label, x.value, x.sub])).toEqual([
      ["Workouts", "11 of 12", "planned so far in November"],
      ["Squat", "+20 lb", "est. max since Sep 7"],
    ]);
  });
  it("for anyone else, how many lifts are getting stronger; working sets only to fill a gap", () => {
    const m = progressSnapshot({
      month: { label: "November", planned: 0, done: 0 },
      strength: { up: 3, tracked: 5 },
      prs: { count: 2, names: ["Leg Press", "Row"] },
      setsLastWeek: 30,
    });
    expect(m.map((x) => x.key)).toEqual(["strength", "prs"]);
    expect(m[0]).toMatchObject({ value: "3 of 5", sub: "lifts, last 12 weeks" });
    const thin = progressSnapshot({
      month: { label: "November", planned: 0, done: 0 },
      strength: null,
      prs: { count: 0, names: [] },
      setsLastWeek: 22,
    });
    expect(thin).toEqual([{ key: "sets", label: "Working sets", value: "22", sub: "last week" }]);
  });
  it("speaks for the competition lift with the most hard sessions in 12 weeks (4+), else none", () => {
    const pts = ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"].map((d) =>
      pt("bench", d, 300),
    );
    expect(snapshotLift(pts, "2026-11-22")).toBe("bench");
    expect(snapshotLift(pts.slice(0, 3), "2026-11-22")).toBeNull();
  });
  it("counts lifts moving from hard sets only, on the athlete's own day", () => {
    const r = (day: string, load: number, rpe: number) => ({
      exercise_name: "Leg Press",
      date: `${day}T18:00:00`,
      load,
      reps: 8,
      rpe,
      rir: null,
      counts_load: true,
    });
    const results = [
      r("2026-09-01", 300, 8),
      r("2026-09-15", 310, 8),
      r("2026-10-01", 320, 8),
      r("2026-10-20", 330, 8),
      r("2026-10-21", 400, 5),
    ];
    const lt = liftsTrending(results, "2026-08-25", "2026-11-22", (x) => comparableE1rm(x as any));
    expect(lt).toMatchObject({ tracked: 1, up: 1 });
  });
});

describe("cardio targets", () => {
  it("the main target big, what else counts under it, calories said as an estimate", () => {
    expect(cardioTargetsView({ minutes: 15, steps: 1500, calories: 100 })).toEqual({
      primary: "15 min",
      alternatives:
        "Or stop at 1,500 steps, or ~100 cal on the machine (an estimate), whichever comes first",
    });
    expect(cardioTargetsView({ minutes: 20 })).toEqual({ primary: "20 min", alternatives: null });
    expect(cardioTargetsView({ minutes: 20, calories: 140, showCalories: false })).toEqual({
      primary: "20 min",
      alternatives: null,
    });
  });
  it("hides only the old boilerplate rule (12 of 32 real targets), never a coach's own words", () => {
    expect(
      cardioNoteForAthlete(
        "Complete the session when ANY ONE target is reached. Stop when whichever target comes first.",
      ),
    ).toBeNull();
    expect(
      cardioNoteForAthlete(
        "Incline 5 · speed 2–3 mph. Complete the session when ANY ONE target is reached; stop when whichever target comes first.",
      ),
    ).toBeNull();
    expect(
      cardioNoteForAthlete(
        "Keep it conversational. Complete the session when ANY ONE target is reached.",
      ),
    ).toBe("Keep it conversational.");
    expect(cardioNoteForAthlete("Walk after lifting")).toBe("Walk after lifting");
  });
});

describe("the screens", () => {
  const chart = read("src/components/analytics/strength-trend-chart.tsx");
  const dash = read("src/components/analytics/client-analytics-dashboard.tsx");
  it("the strength chart is one lift at a time by default, Compare in % change, a stepped line that never curves", () => {
    expect(chart).toContain('{ key: "compare" as View, label: "Compare" }');
    expect(chart).not.toContain('"all"');
    // a step: flat until the next session, then to its value (never a smoothed curve)
    expect(chart).toContain("H${x(b.day)} V${y(b.value)}");
    expect(chart).not.toContain("monotone");
    // an honest axis: never zoomed in past a change worth drawing
    expect(chart).toContain("niceTicks(Math.min(...vals), Math.max(...vals), 4, minSpan)");
    expect(chart).toContain("Meet");
  });
  it("analytics is Overview · Strength · Training · Records; what was logged at check-out is its own section", () => {
    expect(dash).toContain('["training", "Training"]');
    expect(dash).toContain('["records", "Records"]');
    expect(dash).toContain('title="Sleep, recovery and pain"');
    // the readiness estimate isn't an analytics section (Workouts shows it when it's news)
    expect(dash).not.toContain("<RecoveryPreviewCard");
  });
  it("the total is an estimate or a meet, never mixed, with no 'typical range' read", () => {
    const d = read("src/components/analytics/sbd-donut.tsx");
    expect(d).not.toContain("typical");
    expect(d).toContain("Shares describe the total; they don't mean a lift is weak.");
    expect(d).toContain('Tested 1RM');
    expect(d).toContain("Training max");
  });
  it("the cardio card never says 'Done at any one'", () => {
    const c = read("src/components/cardio/CardioCompletionCard.tsx");
    expect(c).not.toContain("Done at any one");
    expect(c).toContain("data-cardio-target");
  });
  it("any exercise's chart uses the same honest axis", () => {
    expect(read("src/components/analytics/lift-progress-card.tsx")).toContain(
      "niceDomain(vals, { minSpan:",
    );
  });
  it("bodyweight change is between weekly averages, never one weigh-in to another", () => {
    const b = read("src/components/analytics/bodyweight-trend-card.tsx");
    expect(b).toContain("const rangeChange = comparable ? avg7 - avgFirst : null;");
  });
});
