import { describe, expect, it } from "vitest";
import { meetsFromRows, strengthPoints } from "@/lib/analytics/competition-strength";
import {
  bestLiftsTotal,
  bodyweightAt,
  estimateTotalAt,
  meetTotals,
  monthlyEstimateTotals,
  readDna,
  trainingSingles,
} from "@/lib/analytics/strength-dna";
import {
  buildPerformanceCalendar,
  calendarRange,
  cellLook,
  dayLabel,
  gridWeeks,
  stepRange,
  summarizeRange,
  weekConsistency,
} from "@/lib/analytics/performance-calendar";
import { buildMuscleExposure, creditsFor, MUSCLE_SITES } from "@/lib/analytics/muscle-exposure";
import { buildLifetimeStats } from "@/lib/analytics/lifetime-stats";
import { dualLoad, loadDelta, loadNum, volumeCompact, volumeNum } from "@/lib/analytics/units";
import { buildTrainingLoad, FINE_MUSCLES, type LoadSet } from "@/lib/analytics/training-load";
import { resultsToLoadSets } from "@/lib/analytics/training-load.queries";
import { atlasView } from "@/lib/pain/anatomy/atlas";

const LB = 2.2046226;

// Jared McIntyre's meet results on file (athlete_powerlifting_results, read Nov 23 2026), kg.
const JARED_MEETS = [
  {
    meet_date: "2026-09-18",
    meet_name: "Commonwealth Championships",
    squat_kg: 235,
    bench_kg: 150,
    deadlift_kg: 270,
    bodyweight_kg: 65.4,
  },
  {
    meet_date: "2026-08-03",
    meet_name: "Regional Powerlifting Championships",
    squat_kg: 242.5,
    bench_kg: 152.5,
    deadlift_kg: 265,
    bodyweight_kg: 65.7,
  },
  {
    meet_date: "2026-03-14",
    meet_name: "Nationals",
    squat_kg: 240,
    bench_kg: 150,
    deadlift_kg: 272.5,
    bodyweight_kg: 65.4,
  },
  {
    meet_date: "2025-07-19",
    meet_name: "MPA Summer Classic",
    squat_kg: 257.5,
    bench_kg: 170,
    deadlift_kg: 280,
    bodyweight_kg: 79,
  },
  {
    meet_date: "2024-03-10",
    meet_name: "Western Canadian Championships",
    squat_kg: 260,
    bench_kg: 170,
    deadlift_kg: 290,
    bodyweight_kg: 73,
  },
  {
    meet_date: "2024-09-14",
    meet_name: "Nationals",
    squat_kg: 247.5,
    bench_kg: 175,
    deadlift_kg: 285,
    bodyweight_kg: 73.6,
  },
];

let seq = 0;
function set(o: Partial<Record<string, any>> & { date: string; load: number; reps: number }): any {
  seq++;
  return {
    id: `s${seq}`,
    set_index: o.set_index ?? 1,
    day_id: o.day_id ?? `d-${o.date.slice(0, 10)}`,
    row_id: o.row_id ?? `r-${seq}`,
    row_order: o.row_order ?? 0,
    exercise_id: o.exercise_id ?? null,
    exercise_name: o.exercise_name ?? "Competition Squat",
    is_competition_lift: o.is_competition_lift ?? true,
    competition_lift_type: o.competition_lift_type ?? "squat",
    counts_load: o.counts_load ?? o.load > 0,
    load_type: o.load_type ?? "external",
    rpe: o.rpe ?? null,
    rir: o.rir ?? null,
    primary_muscles: o.primary_muscles ?? ["quads", "glutes"],
    secondary_muscles: o.secondary_muscles ?? ["adductors"],
    counts_toward_volume: true,
    category: null,
    movement_family: o.movement_family ?? null,
    exercise_movement_family: o.exercise_movement_family ?? o.competition_lift_type ?? null,
    primary_movement_pattern: null,
    muscle_group: null,
    ...o,
  };
}

describe("units", () => {
  it("says a lift in both units from the same lb value, rounded the same way everywhere", () => {
    const lb = 242.5 * LB;
    expect(loadNum(lb, "kg")).toBe("242.5");
    expect(loadNum(lb, "lb")).toBe("535");
    expect(dualLoad(655 * LB, "lb")).toEqual({ main: "1,444 lb", other: "655 kg" });
    expect(loadNum(187.34 * LB, "kg")).toBe("187.5");
    expect(loadDelta(-7.5 * LB, "kg")).toBe("−7.5 kg");
    expect(loadDelta(0.2, "lb")).toBe("±0 lb");
    expect(volumeNum(10_852_411, "lb")).toBe("10,852,411");
    expect(volumeNum(10_852_411, "kg")).toBe("4,922,571");
    expect(volumeCompact(10_852_411, "lb")).toBe("10.9M");
    expect(volumeCompact(48_200, "lb")).toBe("48.2k");
  });
});

describe("Strength DNA", () => {
  const meets = meetsFromRows(JARED_MEETS);

  it("reads each meet as its own total, with its own bodyweight and GL points", () => {
    const totals = meetTotals(meets, "male");
    expect(totals[0].label).toBe("Commonwealth Championships");
    expect(totals[0].sameDay).toBe(true);
    expect(loadNum(totals[0].totalLb, "kg")).toBe("655");
    // 235 / 655, 150 / 655, 270 / 655
    expect(Math.round(totals[0].parts.squat.share * 1000) / 10).toBe(35.9);
    expect(Math.round(totals[0].parts.bench.share * 1000) / 10).toBe(22.9);
    expect(Math.round(totals[0].parts.deadlift.share * 1000) / 10).toBe(41.2);
    const sum =
      totals[0].parts.squat.share + totals[0].parts.bench.share + totals[0].parts.deadlift.share;
    expect(sum).toBeCloseTo(1, 10);
    expect(totals[0].gl?.estimate).toBe(false);
    expect(totals[0].gl?.value).toBeGreaterThan(90);
  });

  it("best lifts take each lift's heaviest single from different meets and say so, with no GL", () => {
    const best = bestLiftsTotal({ meets, today: "2026-11-23" })!;
    expect(loadNum(best.parts.squat.lb, "kg")).toBe("260");
    expect(best.parts.bench.from).toBe("Nationals");
    expect(loadNum(best.parts.bench.lb, "kg")).toBe("175");
    expect(loadNum(best.parts.deadlift.lb, "kg")).toBe("290");
    expect(best.sameDay).toBe(false);
    expect(best.gl).toBeNull();
    expect(best.bodyweightLb).toBeNull();
  });

  it("a training single or a tested 1RM can be a best lift; an estimate never is", () => {
    const results = [
      set({
        date: "2026-11-10T18:00:00",
        load: 300 * LB,
        reps: 1,
        rpe: 9.5,
        competition_lift_type: "deadlift",
        exercise_name: "Competition Deadlift",
      }),
    ];
    const singles = trainingSingles(results);
    expect(singles.deadlift?.day).toBe("2026-11-10");
    const best = bestLiftsTotal({
      meets,
      singles,
      today: "2026-11-23",
      maxes: [{ lift: "bench", kind: "tested", lb: 180 * LB, date: "2026-10-01" }],
    })!;
    expect(best.parts.deadlift.source).toBe("training");
    expect(best.parts.bench.source).toBe("tested");
    // an entered (untested) max never counts
    const entered = bestLiftsTotal({
      meets,
      today: "2026-11-23",
      maxes: [{ lift: "bench", kind: "on_file", lb: 200 * LB, date: null }],
    })!;
    expect(entered.parts.bench.source).toBe("meet");
  });

  it("no best-lifts total until all three lifts have a lift on file", () => {
    expect(
      bestLiftsTotal({
        meets: [],
        today: "2026-11-23",
        singles: { squat: { lb: 400, day: "2026-11-01" } },
      }),
    ).toBeNull();
  });

  it("an estimated total needs all three lifts with a hard set in the last 6 weeks", () => {
    const results = [
      set({
        date: "2026-11-02T18:00:00",
        load: 405,
        reps: 3,
        rpe: 8,
        competition_lift_type: "squat",
      }),
      set({
        date: "2026-11-04T18:00:00",
        load: 285,
        reps: 3,
        rpe: 8,
        competition_lift_type: "bench",
        exercise_name: "Competition Bench",
      }),
    ];
    const pts = strengthPoints(results).points;
    expect(estimateTotalAt({ points: pts, day: "2026-11-23", sex: "male" })).toBeNull();
    results.push(
      set({
        date: "2026-11-06T18:00:00",
        load: 495,
        reps: 2,
        rpe: 8,
        competition_lift_type: "deadlift",
        exercise_name: "Competition Deadlift",
      }),
    );
    const pts2 = strengthPoints(results).points;
    const weighIns = [
      { day: "2026-11-05", lb: 150 },
      { day: "2026-11-06", lb: 152 },
    ];
    const est = estimateTotalAt({ points: pts2, day: "2026-11-23", sex: "male", weighIns })!;
    expect(est.kind).toBe("estimate");
    expect(est.bodyweightLb).toBe(151);
    expect(est.gl?.estimate).toBe(true);
    expect(est.parts.squat.set?.reps).toBe(3);
    // an old estimate is never added to a current one
    expect(estimateTotalAt({ points: pts2, day: "2027-01-30", sex: "male" })).toBeNull();
  });

  it("bodyweight is the week's average, else the last weigh-in within 14 days, else none", () => {
    const w = [
      { day: "2026-11-01", lb: 150 },
      { day: "2026-11-04", lb: 152 },
    ];
    expect(bodyweightAt("2026-11-05", w)).toBe(151);
    expect(bodyweightAt("2026-11-15", w)).toBe(152);
    expect(bodyweightAt("2026-11-30", w)).toBeNull();
  });

  it("monthly estimates only count a month with its own sessions", () => {
    const results = [
      set({
        date: "2026-09-02T18:00:00",
        load: 400,
        reps: 3,
        rpe: 8,
        competition_lift_type: "squat",
      }),
      set({
        date: "2026-09-04T18:00:00",
        load: 280,
        reps: 3,
        rpe: 8,
        competition_lift_type: "bench",
        exercise_name: "Competition Bench",
      }),
      set({
        date: "2026-09-06T18:00:00",
        load: 500,
        reps: 2,
        rpe: 8,
        competition_lift_type: "deadlift",
        exercise_name: "Competition Deadlift",
      }),
    ];
    const months = monthlyEstimateTotals({
      points: strengthPoints(results).points,
      today: "2026-11-23",
      sex: "male",
    });
    // September has its own sessions; October carries them (within 6 weeks) but has none of its own
    expect(months.map((m) => m.label)).toEqual(["2026-09"]);
  });

  it("reads the split against a typical lifter and against their own meets, descriptively", () => {
    const totals = meetTotals(meets, "male");
    const read = readDna(totals[0], "male", totals);
    expect(read.typical?.lines.find((l) => l.lift === "bench")?.points).toBe(-1.1);
    expect(read.typical?.lines.every((l) => l.leans === null)).toBe(true);
    expect(read.own?.count).toBe(5);
    expect(read.previous?.total.label).toBe("Regional Powerlifting Championships");
    expect(read.previous!.lifts.squat / LB).toBeCloseTo(-7.5, 6);
    expect(read.timesBodyweight).toBe(10.02);
    expect(read.notes.length).toBeGreaterThan(0);
    expect(read.notes.join(" ")).not.toMatch(/should|train more|weak/i);
    // no sex on file: no typical comparison at all
    expect(readDna(totals[0], null, totals).typical).toBeNull();
  });
});

describe("performance calendar", () => {
  const today = "2026-11-20";
  const results = [
    // Mon Nov 16: squat day, finished
    set({
      date: "2026-11-16T18:00:00",
      day_id: "A",
      load: 400,
      reps: 3,
      rpe: 8,
      competition_lift_type: "squat",
    }),
    set({
      date: "2026-11-16T18:05:00",
      day_id: "A",
      load: 400,
      reps: 3,
      rpe: 8.5,
      competition_lift_type: "squat",
      set_index: 2,
    }),
    // Wed Nov 18: logged, not finished; bodyweight pull-ups add sets and reps, never weight
    set({
      date: "2026-11-18T18:00:00",
      day_id: "B",
      load: 0,
      reps: 10,
      load_type: "bodyweight",
      counts_load: false,
      exercise_name: "Pull Up",
      is_competition_lift: false,
      competition_lift_type: null,
      primary_muscles: ["lats"],
      secondary_muscles: ["biceps"],
    }),
    // earlier squat history for the strength read
    set({
      date: "2026-10-01T18:00:00",
      day_id: "P1",
      load: 380,
      reps: 3,
      rpe: 8,
      competition_lift_type: "squat",
    }),
    set({
      date: "2026-10-15T18:00:00",
      day_id: "P2",
      load: 390,
      reps: 3,
      rpe: 8,
      competition_lift_type: "squat",
    }),
  ];
  const planned = [
    { dayId: "A", date: "2026-11-16", title: "Lower A", optional: false },
    { dayId: "B", date: "2026-11-18", title: "Upper", optional: false },
    { dayId: "C", date: "2026-11-19", title: "Lower B", optional: false },
    { dayId: "D", date: "2026-11-19", title: "Recovery", optional: true },
    { dayId: "E", date: "2026-11-21", title: "Bench", optional: false },
    // trained on another day than written: done, never missed
    { dayId: "P2", date: "2026-10-14", title: "Old", optional: false },
  ];
  const cal = buildPerformanceCalendar({
    results,
    planned,
    completions: [
      {
        dayId: "A",
        completedAt: "2026-11-16T19:00:00Z",
        activeSeconds: 3600,
        elapsedSeconds: 4000,
        loggingPct: 100,
      },
    ],
    checkouts: [{ day: "2026-11-16", sleepBucket: "7-8", recovery: 4, pain: false }],
    prs: [{ id: results[1].id, headline: true }],
    today,
  });

  it("says each day's workouts and status from what happened", () => {
    expect(cal.days.get("2026-11-16")!.status).toBe("done");
    expect(cal.days.get("2026-11-16")!.workouts[0]).toMatchObject({
      title: "Lower A",
      finished: true,
      durationMin: 60,
    });
    expect(cal.days.get("2026-11-18")!.status).toBe("partial");
    expect(cal.days.get("2026-11-19")!.status).toBe("missed");
    expect(cal.days.get("2026-11-19")!.optionalSkipped).toBe(1);
    expect(cal.days.get("2026-11-21")!.status).toBe("upcoming");
    expect(cal.days.get("2026-10-14")).toBeUndefined();
    expect(cal.days.get("2026-10-15")!.status).toBe("partial");
  });

  it("a workout written before they ever logged a set isn't missed: it wasn't tracked", () => {
    const early = buildPerformanceCalendar({
      results: [set({ date: "2026-11-16T18:00:00", day_id: "A", load: 400, reps: 3, rpe: 8 })],
      planned: [
        { dayId: "Z", date: "2026-08-03", title: "Old program day", optional: false },
        { dayId: "C", date: "2026-11-19", title: "Lower B", optional: false },
      ],
      today: "2026-11-20",
    });
    expect(early.firstLogged).toBe("2026-11-16");
    expect(early.days.get("2026-08-03")!.status).toBe("untracked");
    expect(cellLook(early, "2026-08-03", "workouts")).toEqual({ level: 0 });
    expect(early.days.get("2026-11-19")!.status).toBe("missed");
    const s = summarizeRange(early, { start: "2026-08-01", end: "2026-11-30" });
    expect(s).toMatchObject({ missed: 1, plannedPast: 1 });
  });

  it("counts loaded volume only from external loads", () => {
    const wed = cal.days.get("2026-11-18")!;
    expect(wed.sets).toBe(1);
    expect(wed.reps).toBe(10);
    expect(wed.volumeLb).toBe(0);
    expect(cal.days.get("2026-11-16")!.volumeLb).toBe(2400);
  });

  it("reads strength against the lift's own recent best, never from a day with no hard set", () => {
    const mon = cal.days.get("2026-11-16")!;
    expect(mon.strength?.exercise).toBe("Competition Squat");
    expect(mon.strength!.ratio).toBeGreaterThan(1);
    expect(mon.strength!.newBest).toBe(true);
    expect(cal.days.get("2026-11-18")!.strength).toBeNull();
    expect(cellLook(cal, "2026-11-18", "strength")).toMatchObject({ noRead: true, level: 0 });
    // too little history: no read
    expect(cal.days.get("2026-10-01")!.strength).toBeNull();
  });

  it("puts PRs and check-outs on their day", () => {
    const mon = cal.days.get("2026-11-16")!;
    expect(mon.prs).toHaveLength(1);
    expect(mon.prs[0].headline).toBe(true);
    expect(mon.checkout?.recovery).toBe(4);
    expect(cellLook(cal, "2026-11-16", "prs")).toMatchObject({ level: 2, star: true });
  });

  it("each mode has its own look; missed and planned days are marked, not zero", () => {
    expect(cellLook(cal, "2026-11-16", "workouts").level).toBe(4);
    expect(cellLook(cal, "2026-11-18", "workouts").level).toBe(2);
    expect(cellLook(cal, "2026-11-19", "workouts")).toMatchObject({ missed: true });
    expect(cellLook(cal, "2026-11-21", "workouts")).toMatchObject({ upcoming: true });
    expect(cellLook(cal, "2026-11-17", "volume").level).toBe(0);
  });

  it("week consistency counts written workouts for days that are over", () => {
    expect(weekConsistency(cal, "2026-11-16")).toEqual({ planned: 3, done: 2, daysTrained: 2 });
  });

  it("summarizes a range: done of planned, streaks, standouts", () => {
    const r = calendarRange("week", "2026-11-18", { today });
    expect(r).toMatchObject({ start: "2026-11-16", end: "2026-11-22", label: "This week" });
    const s = summarizeRange(cal, r);
    expect(s).toMatchObject({
      trainingDays: 2,
      workouts: 2,
      finished: 1,
      plannedPast: 3,
      plannedDone: 2,
      missed: 1,
      upcoming: 1,
      prs: 1,
    });
    expect(s.standouts[0]).toMatchObject({ day: "2026-11-16", kind: "best" });
    expect(s.streakWeeks).toBe(1);
  });

  it("ranges: month, year, block, step and grid", () => {
    expect(calendarRange("month", "2026-11-18", { today })).toMatchObject({
      start: "2026-11-01",
      end: "2026-11-30",
      label: "November 2026",
    });
    expect(calendarRange("year", "2026-11-18", { today }).label).toBe("2026");
    const blocks = [
      { id: "b1", name: "Base", start: "2026-09-07", end: "2026-10-04" },
      { id: "b2", name: "Peak", start: "2026-10-05", end: "2026-11-01" },
    ];
    const b = calendarRange("block", "2026-10-10", { today, blocks });
    expect(b).toMatchObject({ label: "Peak", blockId: "b2", start: "2026-10-05" });
    expect(stepRange(b, -1, { blocks, today })).toEqual({ anchor: "2026-09-07", blockId: "b1" });
    expect(stepRange(b, 1, { blocks, today })).toBeNull();
    const weeks = gridWeeks({ start: "2026-11-01", end: "2026-11-30" });
    expect(weeks[0].days[0]).toBeNull();
    expect(weeks[0].days[6]).toBe("2026-11-01");
    expect(weeks.flatMap((w) => w.days).filter(Boolean)).toHaveLength(30);
    expect(dayLabel(cal.days.get("2026-11-16"), "2026-11-16")).toBe(
      "Mon, Nov 16: Lower A, done, 2 sets, 1 PR",
    );
  });
});

describe("muscle exposure", () => {
  const today = "2026-11-23";
  const rows = [
    // two full weeks: Nov 9 and Nov 16
    set({
      date: "2026-11-10T18:00:00",
      day_id: "w1a",
      load: 300,
      reps: 5,
      rpe: 8,
      exercise_name: "Bench Press",
      is_competition_lift: false,
      competition_lift_type: null,
      primary_muscles: ["chest"],
      secondary_muscles: ["triceps", "front delts"],
    }),
    set({
      date: "2026-11-10T18:01:00",
      day_id: "w1a",
      load: 300,
      reps: 5,
      rpe: 8,
      exercise_name: "Bench Press",
      is_competition_lift: false,
      competition_lift_type: null,
      primary_muscles: ["chest"],
      secondary_muscles: ["triceps", "front delts"],
    }),
    set({
      date: "2026-11-12T18:00:00",
      day_id: "w1b",
      load: 60,
      reps: 12,
      rpe: 8,
      exercise_name: "Triceps Pushdown",
      is_competition_lift: false,
      competition_lift_type: null,
      primary_muscles: ["triceps"],
      secondary_muscles: [],
    }),
    set({
      date: "2026-11-17T18:00:00",
      day_id: "w2a",
      load: 300,
      reps: 5,
      rpe: 8,
      exercise_name: "Bench Press",
      is_competition_lift: false,
      competition_lift_type: null,
      primary_muscles: ["chest"],
      secondary_muscles: ["triceps", "front delts"],
    }),
  ];
  const sets = resultsToLoadSets(rows);
  const load = buildTrainingLoad({
    sets,
    today,
    range: { start: "2026-11-09", end: "2026-11-23" },
  });

  it("credits primary a full set and secondary by the rule picked", () => {
    const c = creditsFor(
      { primary: ["chest"], secondary: ["triceps", "chest"], fallbackMuscle: null },
      0.5,
    );
    expect(c.get("Chest")).toEqual({ w: 1, primary: true });
    expect(c.get("Triceps")).toEqual({ w: 0.5, primary: false });
    expect(
      creditsFor({ primary: ["chest"], secondary: ["triceps"], fallbackMuscle: null }, 0).has(
        "Triceps",
      ),
    ).toBe(false);
  });

  it("with the default rule, sets a week match the Volume read exactly", () => {
    const read = buildMuscleExposure({
      periodSets: sets,
      allSets: sets,
      basisKeys: load.perWeekBasis.keys!,
      partial: load.perWeekBasis.partial,
      end: today,
      today,
    });
    for (const m of read.muscles) {
      const tl = load.muscles.find((x) => x.muscle === m.muscle);
      expect(m.perWeek).toBe(tl?.perWeek ?? 0);
      expect(m.directPerWeek).toBe(tl?.directPerWeek ?? 0);
    }
    const chest = read.muscles.find((m) => m.muscle === "Chest")!;
    expect(chest.perWeek).toBe(1.5);
    expect(chest.frequency).toBe(1);
    expect(chest.exercises[0]).toMatchObject({ name: "Bench Press", direct: 3, indirect: 0 });
    const tri = read.muscles.find((m) => m.muscle === "Triceps")!;
    // 3 bench sets × ½ + 1 pushdown
    expect(tri.perWeek).toBe(1.3);
    expect(tri.exercises.map((e) => e.name)).toEqual(["Bench Press", "Triceps Pushdown"]);
    expect(read.muscles[0].level).toBe(4);
    expect(read.muscles.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1, 6);
  });

  it("changing the rule changes the numbers and says which rule", () => {
    const full = buildMuscleExposure({
      periodSets: sets,
      allSets: sets,
      basisKeys: load.perWeekBasis.keys!,
      partial: false,
      end: today,
      today,
      secondary: 1,
    });
    expect(full.rule).toBe(1);
    expect(full.muscles.find((m) => m.muscle === "Triceps")!.perWeek).toBe(2);
    const none = buildMuscleExposure({
      periodSets: sets,
      allSets: sets,
      basisKeys: load.perWeekBasis.keys!,
      partial: false,
      end: today,
      today,
      secondary: 0,
    });
    expect(none.muscles.find((m) => m.muscle === "Front delts")).toBeUndefined();
  });

  it("every muscle is drawn on the anatomy (only sites that exist)", () => {
    const front = new Set(atlasView("front").parts.map((p) => p.site));
    const back = new Set(atlasView("back").parts.map((p) => p.site));
    for (const m of FINE_MUSCLES) {
      const s = MUSCLE_SITES[m];
      expect(s.front.length + s.back.length).toBeGreaterThan(0);
      for (const x of s.front) expect(front.has(x), `${m} front ${x}`).toBe(true);
      for (const x of s.back) expect(back.has(x), `${m} back ${x}`).toBe(true);
    }
  });
});

describe("lifetime", () => {
  it("adds up loaded volume without inventing weight for bodyweight or assisted sets", () => {
    const rows = [
      set({ date: "2026-06-15T18:00:00", day_id: "a", load: 200, reps: 5 }),
      set({
        date: "2026-06-15T18:02:00",
        day_id: "a",
        load: 0,
        reps: 10,
        load_type: "bodyweight",
        counts_load: false,
      }),
      set({
        date: "2026-07-02T18:00:00",
        day_id: "b",
        load: 0,
        reps: 8,
        load_type: "assisted",
        counts_load: false,
        assist_lb: 40,
      }),
      set({ date: "2026-07-02T18:03:00", day_id: "b", load: 0, reps: 8, counts_load: false }),
      set({
        date: "2026-09-01T18:00:00",
        day_id: "c",
        load: 100,
        reps: 10,
        competition_lift_type: "bench",
        exercise_name: "Competition Bench",
      }),
    ];
    const s = buildLifetimeStats({
      results: rows,
      finishedDayIds: ["a", "c"],
      blocks: [
        { id: "B1", name: "Base", status: "Completed", start: "2026-06-15" },
        { id: "B2", name: "Never trained", status: "Completed", start: "2026-10-01" },
      ],
      dayBlock: new Map([["a", "B1"]]),
      prCount: 3,
    });
    expect(s.volumeLb).toBe(2000);
    expect(s).toMatchObject({
      sets: 5,
      loadedSets: 2,
      bodyweightSets: 1,
      assistedSets: 1,
      reps: 41,
      workouts: 3,
      finishedWorkouts: 2,
      trainingDays: 3,
      blocksCompleted: 1,
      prs: 3,
    });
    expect(s.coverage).toMatchObject({ noWeightSets: 1, since: "2026-06-15" });
    // every month in between, a quiet one as zero, running total
    expect(s.months.map((m) => [m.month, m.volumeLb, m.cumulativeLb])).toEqual([
      ["2026-06", 1000, 1000],
      ["2026-07", 0, 1000],
      ["2026-08", 0, 1000],
      ["2026-09", 1000, 2000],
    ]);
    expect(s.byLift.find((g) => g.key === "bench")).toMatchObject({ volumeLb: 1000, sets: 1 });
    expect(s.byBlock.find((g) => g.key === "B1")).toMatchObject({
      label: "Base",
      volumeLb: 1000,
      workouts: 1,
    });
    expect(s.byYear).toHaveLength(1);
  });

  it("marks milestones on the day they were crossed, in the unit picked", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      set({
        date: `2026-06-${String(i + 1).padStart(2, "0")}T18:00:00`,
        day_id: `w${i}`,
        load: 1000,
        reps: 10,
      }),
    );
    const s = buildLifetimeStats({ results: rows });
    expect(s.milestones.reached.find((m) => m.kind === "workouts")).toMatchObject({
      label: "10 workouts",
      reached: "2026-06-10",
    });
    expect(s.milestones.reached.find((m) => m.kind === "volume")).toMatchObject({
      label: "100,000 lb lifted",
      reached: "2026-06-10",
    });
    const kg = buildLifetimeStats({ results: rows, unit: "kg" });
    expect(kg.milestones.reached.find((m) => m.kind === "volume")).toMatchObject({
      label: "50,000 kg lifted",
    });
    expect(s.milestones.next.find((m) => m.kind === "workouts")).toMatchObject({
      label: "25 workouts",
    });
  });
});

describe("the screens", () => {
  const read = (p: string) => require("node:fs").readFileSync(p, "utf8") as string;
  const dash = read("src/components/analytics/client-analytics-dashboard.tsx");
  it("the overview is one picture per area, each saying its own range, and a tap opens the area", () => {
    expect(dash).toContain(
      "<StrengthDnaCard dna={dna} unit={displayUnit} sex={competition.data?.sex ?? null} compact",
    );
    expect(dash).toContain(
      "<PerformanceCalendar cal={calendar} blocks={calBlocks} unit={displayUnit} clientId={clientId} coach={coach} compact",
    );
    expect(dash).toContain(
      "<MuscleMap read={exposure} rule={muscleRule} rangeLabel={filter.short} compact",
    );
    expect(dash).toContain("<LifetimeSection stats={lifetime} unit={displayUnit} compact");
    expect(dash).toContain("basisKeys: trainingLoad.load.perWeekBasis.keys ?? []");
  });
  it("the calendar and lifetime keep their own range; the unit is one remembered choice", () => {
    expect(dash).toContain('view === "calendar" || view === "lifetime" ? (');
    expect(dash).toContain("useAnalyticsUnit(preferredUnit)");
    expect(read("src/components/training-analytics-preview-card.tsx")).toContain(
      "useAnalyticsUnit(accountUnit)",
    );
  });
  it("Strength DNA never puts an estimate into best lifts and says when lifts are from different days", () => {
    const lib = read("src/lib/analytics/strength-dna.ts");
    expect(lib).toContain('t.kind === "tested" && t.lb > 0');
    expect(lib).not.toMatch(/source: "estimate"[^\n]*bestLifts/);
    const card = read("src/components/analytics/strength-dna-card.tsx");
    expect(card).toContain("Each lift's heaviest single, from different days");
    expect(card).toContain("data-dna-table");
  });
  it("the muscle map says how it counts, lets the athlete pick, and isn't a measure of growth", () => {
    const map = read("src/components/analytics/muscle-map.tsx");
    expect(map).toContain("This is training exposure, not a measure of muscle growth.");
    expect(map).toContain('testId="muscle-rule"');
    expect(map).toContain("data-muscle-list");
  });
  it("lifetime says what isn't counted", () => {
    const life = read("src/components/analytics/lifetime-section.tsx");
    expect(life).toContain("data-lifetime-coverage");
    expect(life).toContain("never as weight lifted");
  });
});
