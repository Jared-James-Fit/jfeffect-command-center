/**
 * Training analytics redesign, Nov 23 2026: every set counted with its
 * confidence, a line that never draws a light week as strength lost, the
 * performance calendar, SBD workload and composition, the muscle read,
 * records, recovery patterns and Cleo's one observation.
 */
import { describe, expect, it } from "vitest";
import {
  envelopeAt,
  envelopeTrend,
  flagOutliers,
  sessionEstimates,
  setEstimate,
  strengthEnvelope,
  MAX_FALL_PER_WEEK,
  type SessionEstimate,
} from "@/lib/analytics/strength-estimate";
import { isMeetLog, liftStrengths, mainLift } from "@/lib/analytics/lift-strength";
import {
  buildCalendar,
  calendarLayout,
  calendarTotals,
  strengthChanges,
  weekColumns,
} from "@/lib/analytics/performance-calendar";
import { lifetimeTotals, personalRecords, recordsByExercise } from "@/lib/analytics/records";
import { buildWorkload, inScope, workloadShifts } from "@/lib/analytics/sbd-workload";
import {
  donutArcs,
  estimatedComposition,
  meetCompositions,
  shareContext,
} from "@/lib/analytics/sbd-composition";
import { buildMuscleRead, musclesNamed, muscleRoles } from "@/lib/analytics/muscle-read";
import { recoveryPatterns } from "@/lib/analytics/recovery-intel";
import { pickObservation, type ObservationInput } from "@/lib/analytics/performance-observation";
import { blockRows, defaultBlockType } from "@/lib/analytics/block-comparison";
import { meetsFromRows } from "@/lib/analytics/competition-strength";
import type { LoadSet, MuscleLoad } from "@/lib/analytics/training-load";

const sess = (
  day: string,
  e1rm: number,
  confidence: "high" | "medium" | "low" = "high",
): SessionEstimate => ({
  day,
  e1rm,
  confidence,
  set: { load: e1rm, reps: 1, effort: 9 },
  heaviest: e1rm,
});

const res = (
  day: string,
  opts: Partial<{
    lift: string;
    load: number;
    reps: number;
    rpe: string | null;
    comp: boolean;
    name: string;
    dayId: string;
    id: string;
  }> = {},
) => ({
  id: opts.id ?? `${day}-${Math.random()}`,
  date: `${day}T18:00:00`,
  day_id: opts.dayId ?? `day-${day}`,
  is_competition_lift: opts.comp ?? true,
  competition_lift_type: opts.lift ?? "squat",
  exercise_name: opts.name ?? "Competition Squat",
  exercise_id: opts.name ? `ex-${opts.name}` : "ex-squat",
  load: opts.load ?? 300,
  reps: opts.reps ?? 5,
  rpe: opts.rpe === undefined ? "8" : opts.rpe,
  rir: null,
  counts_load: true,
});

describe("every set says what it can about a max, with its confidence", () => {
  it("hard sets are high, lighter ones medium, unrated ones low, warm-up-light and high-rep sets nothing", () => {
    expect(setEstimate({ load: 335, reps: 5, rpe: 8 })?.confidence).toBe("high");
    expect(setEstimate({ load: 375, reps: 4, rpe: 6 })?.confidence).toBe("medium");
    expect(setEstimate({ load: 300, reps: 12, rpe: 8 })?.confidence).toBe("medium");
    expect(setEstimate({ load: 300, reps: 5, rpe: null })?.confidence).toBe("low");
    expect(setEstimate({ load: 300, reps: 5, rpe: 4 })).toBeNull();
    expect(setEstimate({ load: 100, reps: 15, rpe: 9 })).toBeNull();
    // a hard set: the reps done plus the reps left; a lighter one: at most 2 left credited
    expect(setEstimate({ load: 335, reps: 5, rpe: 8 })!.e1rm).toBeCloseTo(413.2, 0);
    expect(setEstimate({ load: 375, reps: 4, rpe: 6 })!.e1rm).toBeCloseTo(448, 0);
  });

  it("a session is its most confident set, never a lighter one over a hard one", () => {
    const s = sessionEstimates([
      { day: "2026-11-02", load: 500, reps: 1, rpe: 6 },
      { day: "2026-11-02", load: 455, reps: 3, rpe: 8 },
    ]);
    expect(s[0].confidence).toBe("high");
    expect(s[0].set.load).toBe(455);
  });

  it("flags an estimate far off the ones around it (a kg typed as lb) and keeps it out of the line", () => {
    const pts = flagOutliers([
      sess("2026-10-01", 450),
      sess("2026-10-08", 455),
      sess("2026-10-15", 452),
      sess("2026-10-22", 205),
      sess("2026-10-29", 458),
    ]);
    expect(pts.find((p) => p.day === "2026-10-22")?.outlier).toBe("low");
    const env = strengthEnvelope(pts);
    expect(env.every((p) => p.value > 400)).toBe(true);
  });
});

describe("the estimated-strength line", () => {
  it("never falls for a light block: RPE 6 work holds the line (and can raise it), it doesn't drop it", () => {
    const env = strengthEnvelope([
      sess("2026-09-01", 480),
      sess("2026-09-20", 470, "medium"),
      sess("2026-10-10", 430, "medium"),
      sess("2026-10-30", 440, "medium"),
    ]);
    expect(envelopeAt(env, "2026-10-30")!.value).toBe(480);
    expect(envelopeAt(env, "2026-10-30")!.state).toBe("stale");
  });

  it("a lighter set that implies more raises it halfway: low-RPE work contributes, it never sets a max alone", () => {
    const env = strengthEnvelope([sess("2026-10-26", 413), sess("2026-11-16", 450, "medium")]);
    expect(envelopeAt(env, "2026-11-16")).toMatchObject({ value: 431.5, state: "raised" });
    // a second one that agrees takes it most of the way, never past what they imply
    const two = strengthEnvelope([
      sess("2026-10-26", 413),
      sess("2026-11-16", 450, "medium"),
      sess("2026-11-20", 450, "medium"),
    ]);
    expect(envelopeAt(two, "2026-11-20")!.value).toBeGreaterThan(440);
    expect(envelopeAt(two, "2026-11-20")!.value).toBeLessThan(450);
  });

  it("one hard session under the line is a fluctuation; it takes sustained lower hard sets to fall", () => {
    const one = strengthEnvelope([sess("2026-09-01", 500), sess("2026-09-22", 470)]);
    expect(envelopeAt(one, "2026-09-22")!.value).toBe(500);
    const two = strengthEnvelope([
      sess("2026-09-01", 500),
      sess("2026-10-15", 470),
      sess("2026-10-20", 472),
      sess("2026-11-03", 471),
      sess("2026-11-17", 473),
    ]);
    // it falls, a week at a time, and settles where the hard sets keep saying
    const at20 = envelopeAt(two, "2026-10-20")!.value;
    expect(at20).toBeLessThan(500);
    expect(at20).toBeGreaterThan(472);
    const settled = envelopeAt(two, "2026-11-17")!.value;
    expect(settled).toBeGreaterThan(471);
    expect(settled).toBeLessThan(474);
  });

  it("never drops a meet max 20% in a month on volume-block sets of 5 (Jared, Oct 2026): they aren't comparable to a single", () => {
    // Commonwealth squat 518 lb; then 315x5 @7 and 335x5 @8 read ~400 on the RPE chart
    const fives = sessionEstimates([
      { day: "2026-10-06", load: 315, reps: 5, rpe: 7 },
      { day: "2026-10-26", load: 335, reps: 5, rpe: 8 },
      { day: "2026-11-02", load: 325, reps: 5, rpe: 8 },
    ]);
    const env = strengthEnvelope([sess("2026-09-18", 518), ...fives]);
    expect(envelopeAt(env, "2026-11-02")!.value).toBe(518);
    // a month and more of them, and it eases down, at most 1% a week
    const more = sessionEstimates([
      { day: "2026-10-06", load: 315, reps: 5, rpe: 7 },
      { day: "2026-10-13", load: 320, reps: 5, rpe: 7.5 },
      { day: "2026-10-26", load: 335, reps: 5, rpe: 8 },
      { day: "2026-11-09", load: 325, reps: 5, rpe: 8 },
    ]);
    const after = envelopeAt(strengthEnvelope([sess("2026-09-18", 518), ...more]), "2026-11-09")!.value;
    expect(after).toBeLessThan(518);
    expect(after).toBeGreaterThan(518 * (1 - MAX_FALL_PER_WEEK * 0.5 * 5.2));
  });

  it("a meet's attempts typed into the app days later are the meet, never an RPE estimate over it", () => {
    const meets = meetsFromRows([
      {
        meet_date: "2026-09-18",
        squat_kg: 235,
        bench_kg: 150,
        deadlift_kg: 270,
        bodyweight_kg: 65.4,
      },
    ]);
    const dl = (day: string, load: number, rpe = "8", reps = 1) =>
      res(day, { lift: "deadlift", name: "Competition Deadlift", load, reps, rpe });
    // Jared's Commonwealth pull, logged Sep 21 at "RPE 8": the chart reads it as 655 lb
    const s = liftStrengths(
      [dl("2026-09-01", 495, "8.5", 4), dl("2026-09-21", 545.6), dl("2026-09-21", 595.2)],
      meets,
      "2026-09-25",
    );
    // the line reads the meet as training-day capacity: never the 655 the typed RPE says, never over the meet
    const line = envelopeAt(s.deadlift.envelope, "2026-09-25")!.value;
    expect(line).toBeLessThanOrEqual(595.2);
    expect(line).toBeGreaterThan(595.2 / 1.03);
    expect(s.deadlift.meets[0].lb).toBeCloseTo(595.2, 0);
    expect(s.deadlift.sessions.some((x) => x.day === "2026-09-21")).toBe(false);
    // a session days later at another weight, or a week and more later, is training
    expect(isMeetLog({ day: "2026-09-21", heaviest: 560 }, { day: "2026-09-18", lb: 595.2 })).toBe(
      false,
    );
    expect(
      isMeetLog({ day: "2026-09-28", heaviest: 595.2 }, { day: "2026-09-18", lb: 595.2 }),
    ).toBe(false);
    expect(isMeetLog({ day: "2026-09-20", heaviest: 596 }, { day: "2026-09-18", lb: 595.2 })).toBe(
      true,
    );
  });

  it("a trend across a held stretch says 'we don't know yet', never 'down'", () => {
    const env = strengthEnvelope([sess("2026-08-01", 480), sess("2026-08-20", 490)], {
      until: "2026-11-01",
    });
    expect(envelopeTrend(env, "2026-08-01", "2026-11-01")).toMatchObject({
      kind: "unclear",
      reason: "held",
    });
    const up = strengthEnvelope([
      sess("2026-10-01", 480),
      sess("2026-10-15", 490),
      sess("2026-10-29", 500),
    ]);
    expect(envelopeTrend(up, "2026-10-01", "2026-10-29")).toMatchObject({ kind: "up" });
  });

  it("meets count as lifted, and the main lift is the one trained most", () => {
    const meets = meetsFromRows([
      {
        meet_date: "2026-09-18",
        squat_kg: 210,
        bench_kg: 150,
        deadlift_kg: 250,
        bodyweight_kg: 92,
      },
    ]);
    const s = liftStrengths(
      [
        res("2026-10-01", { load: 405, reps: 3, rpe: "8" }),
        res("2026-10-08", { load: 415, reps: 3, rpe: "8" }),
        res("2026-10-05", { lift: "bench", name: "Competition Bench", load: 280, reps: 3 }),
      ],
      meets,
      "2026-10-10",
    );
    expect(s.squat.meets[0].lb).toBeCloseTo(463, 0);
    // as lifted on the platform; the line is the training-day capacity it implies (a peak isn't every day)
    expect(s.bench.meets[0].lb).toBeCloseTo(330.7, 0);
    expect(envelopeAt(s.bench.envelope, "2026-09-18")!.value).toBeCloseTo(330.7 / 1.025, 0);
    expect(mainLift(s, "2026-09-25", "2026-10-10")).toBe("squat");
  });
});

describe("the performance calendar", () => {
  const plan = [
    { day: "2026-11-02", dayId: "d1", sets: 10 },
    { day: "2026-11-03", dayId: "d2", sets: 10 },
    { day: "2026-11-05", dayId: "d3", sets: 10 },
    { day: "2026-11-12", dayId: "d4", sets: 10 },
  ];
  const results = [
    ...Array.from({ length: 10 }, (_, i) => res("2026-11-02", { id: `a${i}` })),
    ...Array.from({ length: 3 }, (_, i) => res("2026-11-03", { id: `b${i}` })),
    ...Array.from({ length: 5 }, (_, i) => res("2026-11-07", { id: `c${i}` })),
  ];
  const days = buildCalendar({
    results,
    plan,
    prs: [],
    start: "2026-10-30",
    end: "2026-11-14",
    today: "2026-11-10",
    metric: "activity",
    firstLog: "2026-11-01",
  });
  const at = (d: string) => days.find((x) => x.day === d)!;
  it("tells done, partly done, missed, rest, no data and planned ahead apart", () => {
    expect(at("2026-11-02").state).toBe("done");
    expect(at("2026-11-03").state).toBe("partial");
    expect(at("2026-11-05").state).toBe("missed");
    expect(at("2026-11-07").state).toBe("done"); // trained on an unplanned day
    expect(at("2026-11-04").state).toBe("rest");
    expect(at("2026-10-30").state).toBe("none"); // before the first log: no data, never rest
    expect(at("2026-11-12").state).toBe("planned");
    expect(at("2026-11-05").level).toBe(0); // a missed day is never a zero bar: its own state
  });

  it("a month is a grid; weeks as columns only when they fit; else small month calendars (never specks or a sideways scroll)", () => {
    expect(calendarLayout("2026-11-01", "2026-11-30")).toBe("month");
    expect(calendarLayout("2025-11-24", "2026-11-23", 900)).toBe("weeks");
    expect(calendarLayout("2025-11-24", "2026-11-23", 340)).toBe("months");
    expect(calendarLayout("2024-01-01", "2026-11-23", 900)).toBe("months");
    const cols = weekColumns(days);
    expect(cols[0][0]).toBeNull(); // Mon Oct 26 is outside the range
    expect(cols[0][4]?.day).toBe("2026-10-30");
  });

  it("strength is a change in a comparable performance, never how heavy the day was", () => {
    const rs = [
      res("2026-10-01", { load: 400, reps: 3, rpe: "8" }),
      res("2026-10-08", { load: 405, reps: 3, rpe: "8" }),
      res("2026-10-15", { load: 420, reps: 3, rpe: "8" }), // a new best
      res("2026-10-22", { load: 430, reps: 1, rpe: "6" }), // the heaviest weight yet, but it implies less than the best
    ];
    const ch = strengthChanges(rs);
    expect(ch.get("2026-10-15")!.pct).toBeGreaterThan(3);
    expect(ch.has("2026-10-22")).toBe(false);
  });

  it("totals the span: trained, planned done, longest weekly streak", () => {
    const t = calendarTotals(days);
    expect(t.trained).toBe(3);
    expect(t.missed).toBe(1);
    expect(t.bestStreak).toBeGreaterThanOrEqual(1);
  });
});

describe("records", () => {
  it("never counts a first time, one per exercise per day, and only real gains", () => {
    const { records, firsts } = personalRecords([
      res("2026-10-01", { load: 300, reps: 5, id: "1" }),
      res("2026-10-08", { load: 300.5, reps: 5, id: "2" }), // a 0.5 lb rounding difference
      res("2026-10-15", { load: 315, reps: 5, id: "3" }),
      res("2026-10-15", { load: 325, reps: 5, id: "4" }), // the same day: one record, the best
    ]);
    expect(firsts).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ day: "2026-10-15", load: 325 });
    expect(records[0].kinds).toEqual(expect.arrayContaining(["e1rm", "weight"]));
    expect(recordsByExercise(records, [])[0].records).toHaveLength(1);
  });

  it("a competition lift's record has to beat the platform too, not just the app's own logs", () => {
    const meets = meetsFromRows([
      {
        meet_date: "2025-03-01",
        squat_kg: 265,
        bench_kg: 172.5,
        deadlift_kg: 270,
        bodyweight_kg: 73.8,
      },
    ]);
    const sets = [
      res("2026-06-22", { load: 330, reps: 5, rpe: "7", id: "a" }),
      res("2026-08-05", { load: 534.6, reps: 1, rpe: "9", id: "b" }), // best since logging began
    ];
    expect(personalRecords(sets).records.map((r) => r.load)).toEqual([534.6]);
    // 534.6 lb is under the 584 lb squatted at Nationals 2025: no record
    const withMeets = personalRecords(sets, meets);
    expect(withMeets.records).toHaveLength(0);
    // and a squat over it is one, measured against the meet
    const over = personalRecords(
      [...sets, res("2026-10-01", { load: 600, reps: 1, rpe: "9", id: "c" })],
      meets,
    );
    expect(over.records).toHaveLength(1);
    expect(over.records[0].prior.load).toBeCloseTo(584.2, 0);
  });

  it("lifetime totals: weight moved in both units, workouts, longest run of weeks", () => {
    const rs = [
      res("2026-10-01", { load: 100, reps: 10 }),
      res("2026-10-08", { load: 100, reps: 10 }),
      res("2026-10-22", { load: 100, reps: 10 }),
    ];
    const l = lifetimeTotals(rs, []);
    expect(l.liftedLb).toBe(3000);
    expect(l.liftedKg).toBe(1361);
    expect(l.workouts).toBe(3);
    expect(l.bestStreakWeeks).toBe(2);
  });
});

const ls = (
  day: string,
  exercise: string,
  lift: string | null,
  comp: boolean,
  loadLb: number,
  reps: number,
  rpe: number | null = 8,
): LoadSet => ({
  day,
  dayId: null,
  rowId: null,
  exerciseId: null,
  exercise,
  primary:
    lift === "bench"
      ? ["chest"]
      : lift === "squat"
        ? ["quads"]
        : lift === "deadlift"
          ? ["hamstrings"]
          : ["triceps"],
  secondary: lift === "bench" ? ["triceps"] : [],
  rowFamily: lift,
  competitionLiftType: lift,
  isCompetitionLift: comp,
  reps,
  loadKg: loadLb / 2.2046226,
  rpe,
  rir: null,
});

describe("SBD workload", () => {
  const sets = [
    ls("2026-11-02", "Competition Squat", "squat", true, 400, 3),
    ls("2026-11-02", "Competition Squat", "squat", true, 400, 3),
    ls("2026-11-03", "Competition Bench", "bench", true, 280, 3),
    ls("2026-11-03", "Spoto Press", "bench", false, 250, 5),
    ls("2026-11-03", "Dumbbell Bench Press", "bench", false, 90, 10),
  ];
  it("a variation is a barbell variation; a dumbbell press is never bench workload", () => {
    expect(inScope(sets[3], "variations")).toBe("bench");
    expect(inScope(sets[4], "both")).toBeNull();
    expect(inScope(sets[2], "variations")).toBeNull();
  });
  it("sums stack by lift; averages stay per lift and read only what they can", () => {
    const b = buildWorkload({
      sets,
      metric: "sets",
      scope: "both",
      grain: "week",
      start: "2026-11-02",
      end: "2026-11-08",
      today: "2026-11-20",
    });
    expect(b[0].values).toEqual({ squat: 2, bench: 2, deadlift: 0 });
    const avg = buildWorkload({
      sets,
      metric: "avgLoad",
      scope: "comp",
      grain: "week",
      start: "2026-11-02",
      end: "2026-11-08",
      today: "2026-11-20",
    });
    expect(avg[0].values.squat).toBeCloseTo(400, 0);
    expect(avg[0].values.deadlift).toBeNull();
    const t = buildWorkload({
      sets,
      metric: "tonnage",
      scope: "comp",
      grain: "week",
      start: "2026-11-02",
      end: "2026-11-08",
      today: "2026-11-20",
    });
    expect(t[0].values.squat).toBeCloseTo(2400, 0);
  });
  it("% of estimated max reads the lift's line that day; prescribed sets ride along for sets", () => {
    const env = {
      squat: [{ day: "2026-10-01", value: 500, state: "measured" as const, basis: "2026-10-01" }],
    };
    const r = buildWorkload({
      sets,
      metric: "relIntensity",
      scope: "comp",
      grain: "week",
      start: "2026-11-02",
      end: "2026-11-08",
      today: "2026-11-20",
      envelopes: env,
    });
    expect(r[0].values.squat).toBe(80);
    const p = buildWorkload({
      sets,
      plan: [
        {
          rowId: "r",
          dayId: "d",
          day: "2026-11-02",
          sets: 4,
          exercise: "Competition Squat",
          primary: [],
          secondary: [],
          rowFamily: "squat",
          competitionLiftType: "squat",
          isCompetitionLift: true,
          exerciseId: null,
        },
      ],
      metric: "sets",
      scope: "both",
      grain: "week",
      start: "2026-11-02",
      end: "2026-11-08",
      today: "2026-11-20",
    });
    expect(p[0].prescribed?.squat).toBe(4);
  });
  it("excludes future and incomplete weeks without hiding planned buckets", () => {
    const logged = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"].map(
      (day) => ls(day, "Competition Squat", "squat", true, 400, 3),
    );
    const input = {
      sets: logged,
      metric: "sets" as const,
      scope: "comp" as const,
      grain: "week" as const,
      start: "2026-11-02",
      end: "2026-12-06",
      today: "2026-11-26",
    };
    const buckets = buildWorkload(input);
    expect(buckets).toHaveLength(5);
    expect(buckets[3].current).toBe(true);
    expect(buckets[4].future).toBe(true);
    expect(buckets[4].values.squat).toBeNull();
    expect(workloadShifts(buckets, ["squat"])[0].pct).toBe(0);
    const tooEarly = buildWorkload({ ...input, start: "2026-11-15" });
    expect(workloadShifts(tooEarly, ["squat"])).toEqual([]);
  });
  it("shifts compare the last third with the first third of finished buckets", () => {
    const many = [0, 7, 14, 21, 28, 35].flatMap((d, i) =>
      Array.from({ length: 2 + i }, () =>
        ls(
          new Date(Date.UTC(2026, 9, 5 + d)).toISOString().slice(0, 10),
          "Competition Squat",
          "squat",
          true,
          400,
          3,
        ),
      ),
    );
    const b = buildWorkload({
      sets: many,
      metric: "sets",
      scope: "comp",
      grain: "week",
      start: "2026-10-05",
      end: "2026-11-15",
      today: "2026-12-01",
    });
    const s = workloadShifts(b, ["squat"]);
    expect(s[0].pct).toBeGreaterThan(50);
  });
});

describe("SBD composition", () => {
  const meets = meetsFromRows([
    {
      meet_date: "2026-09-18",
      meet_name: "Nationals",
      squat_kg: 210,
      bench_kg: 150,
      deadlift_kg: 250,
    },
    {
      meet_date: "2026-03-01",
      meet_name: "Provincials",
      squat_kg: 200,
      bench_kg: 140,
      deadlift_kg: 240,
    },
  ]);
  it("a meet's shares add to 100 and are read against their own earlier meet, never an ideal split", () => {
    const cs = meetCompositions(meets);
    const total = cs[0].lifts.squat.share + cs[0].lifts.bench.share + cs[0].lifts.deadlift.share;
    expect(total).toBeCloseTo(100, 0);
    const ctx = shareContext(cs[0], cs);
    expect(ctx.bench.words).toMatch(/about the same as Provincials/);
    const arcs = donutArcs(cs[0]);
    expect(arcs[2].end).toBeLessThan(360);
  });
  it("no estimated total unless all three lifts are current (an old squat is never added to this month's bench)", () => {
    const s = liftStrengths(
      [
        res("2026-08-01", { load: 405, reps: 3 }),
        res("2026-11-10", { lift: "bench", name: "Competition Bench", load: 280, reps: 3 }),
        res("2026-11-12", { lift: "deadlift", name: "Competition Deadlift", load: 495, reps: 3 }),
      ],
      [],
      "2026-11-20",
    );
    const e = estimatedComposition(s, "2026-11-20");
    expect(e.composition).toBeNull();
    expect(e.missing).toEqual(["squat"]);
  });
});

describe("the muscle read", () => {
  const muscles: MuscleLoad[] = [
    {
      muscle: "Quads",
      perWeek: 12,
      directPerWeek: 12,
      lastWeek: 12,
      frequency: 2,
      topSessionShare: null,
      changePct: 0,
    },
    {
      muscle: "Chest",
      perWeek: 10,
      directPerWeek: 10,
      lastWeek: 10,
      frequency: 2,
      topSessionShare: null,
      changePct: 0,
    },
    {
      muscle: "Triceps",
      perWeek: 2,
      directPerWeek: 0,
      lastWeek: 2,
      frequency: 2,
      topSessionShare: null,
      changePct: -50,
    },
    {
      muscle: "Hamstrings",
      perWeek: 0.4,
      directPerWeek: 0,
      lastWeek: 0,
      frequency: 0,
      topSessionShare: null,
      changePct: null,
    },
    {
      muscle: "Glutes",
      perWeek: 30,
      directPerWeek: 20,
      lastWeek: 30,
      frequency: 3,
      topSessionShare: null,
      changePct: 0,
    },
  ];
  const sets = Array.from({ length: 30 }, (_, i) =>
    ls(
      `2026-11-${String(1 + (i % 20)).padStart(2, "0")}`,
      "Competition Bench",
      "bench",
      true,
      280,
      3,
    ),
  );
  it("roles follow the athlete: a powerlifter's calves are optional, a named muscle is prime", () => {
    expect(muscleRoles("powerlifting").Calves).toBe("optional");
    expect(musclesNamed("I want bigger glutes and arms")).toEqual(
      expect.arrayContaining(["Glutes", "Biceps", "Triceps"]),
    );
    expect(muscleRoles("powerlifting", ["Calves"]).Calves).toBe("prime");
  });
  it("goal fit reads against their own typical volume: a gap, worth a look, possibly more than the rest", () => {
    const r = buildMuscleRead({
      muscles,
      sets,
      weeks: 4,
      partial: false,
      profile: "powerlifting",
      start: "2026-10-26",
      end: "2026-11-22",
      coached: true,
    });
    const row = (m: string) => r.rows.find((x) => x.muscle === m)!;
    expect(row("Hamstrings").fit.status).toBe("gap");
    expect(row("Triceps").fit.status).toBe("look");
    expect(row("Glutes").fit.status).toBe("more");
    expect(row("Quads").fit.status).toBe("supported");
  });
  it("development needs two kinds of evidence; with too little data everything is unknown", () => {
    const r = buildMuscleRead({
      muscles,
      sets,
      weeks: 4,
      partial: false,
      profile: "powerlifting",
      start: "2026-10-26",
      end: "2026-11-22",
      coached: true,
      liftTrends: {
        bench: {
          kind: "steady",
          pct: 0.5,
          from: { day: "a", value: 330, state: "measured", basis: "a" },
          to: { day: "b", value: 331, state: "measured", basis: "b" },
        },
      },
    });
    const tri = r.rows.find((x) => x.muscle === "Triceps")!;
    expect(tri.dev.status).toBe("opportunity");
    expect(tri.dev.consider).toMatch(/coach/);
    const chest = r.rows.find((x) => x.muscle === "Chest")!;
    expect(chest.dev.status).toBe("steady"); // the bench stalled but chest work is normal: one signal, no claim
    const thin = buildMuscleRead({
      muscles,
      sets: sets.slice(0, 5),
      weeks: 1,
      partial: true,
      profile: "powerlifting",
      start: "a",
      end: "b",
      coached: false,
    });
    expect(thin.rows.every((x) => x.fit.status === "unknown" && x.dev.status === "unknown")).toBe(
      true,
    );
  });
});

describe("recovery patterns", () => {
  it("names a pattern only with enough of each group and a real gap", () => {
    const strength = liftStrengths([], [], "2026-11-20");
    const checkouts = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-10-${String(1 + i * 2).padStart(2, "0")}`,
      sleepBucket: (i % 2 ? "8_9" : "5_6") as any,
      recovery: 3,
      pain: false,
      rating: i % 2 ? 5 : 3,
      logging: 100,
    }));
    const p = recoveryPatterns({
      checkouts,
      days: [],
      strength,
      ratedSets: [],
      today: "2026-11-20",
    });
    expect(p.find((x) => x.id === "sleep")?.title).toMatch(/more sleep/);
    const none = recoveryPatterns({
      checkouts: checkouts.slice(0, 5),
      days: [],
      strength,
      ratedSets: [],
      today: "2026-11-20",
    });
    expect(none).toHaveLength(0);
  });
  it("RPE at the same loads and reps drifting up reads as possible fatigue", () => {
    const strength = liftStrengths([], [], "2026-11-20");
    const ratedSets = [
      ...["2026-10-10", "2026-10-12", "2026-10-15", "2026-10-17"].map((day) => ({
        day,
        lift: "squat" as const,
        load: 400,
        reps: 3,
        rpe: 7,
      })),
      ...["2026-11-05", "2026-11-08", "2026-11-12", "2026-11-15"].map((day) => ({
        day,
        lift: "squat" as const,
        load: 400,
        reps: 3,
        rpe: 8.5,
      })),
    ];
    const p = recoveryPatterns({
      checkouts: [],
      days: [],
      strength,
      ratedSets,
      today: "2026-11-20",
    });
    expect(p.find((x) => x.id === "drift")).toMatchObject({ tone: "watch" });
  });
});

describe("Cleo's one observation", () => {
  const base: ObservationInput = {
    coached: true,
    phase: null,
    unit: "lb",
    conv: (x) => x,
    liftTrends: {},
    setShifts: [],
    rpeShifts: [],
    patterns: [],
    recentRecords: [],
    consistency: { recentPct: null, beforePct: null, planned: 0 },
    mainLift: null,
  };
  it("says nothing when there's nothing worth saying", () => {
    expect(pickObservation(base)).toBeNull();
  });
  it("volume up with effort holding is 'well tolerated'; a coached tip never changes the plan", () => {
    const o = pickObservation({
      ...base,
      setShifts: [{ lift: "squat", from: 10, to: 13, pct: 30 }],
      rpeShifts: [{ lift: "squat", from: 7.5, to: 7.6, pct: 1 }],
    })!;
    expect(o.observation).toMatch(/30% more squat sets/);
    expect(o.observation).not.toMatch(/volume/);
    expect(o.tip).toMatch(/following the plan/i);
    expect(o.basis).toBe("measured");
  });
  it("a muscle's change is said as a change, never as weak or overdone, and reads the athlete's goal", () => {
    const o = pickObservation({
      ...base,
      coached: false,
      profile: "physique",
      muscles: [
        { muscle: "Chest", role: "prime", total: 42, before: 28, changePct: 50 },
        { muscle: "Calves", role: "optional", total: 0, before: 12, changePct: -100 },
      ],
    })!;
    expect(o.id).toBe("muscle:Chest");
    expect(o.observation).toMatch(/trained your chest more in the last six weeks/);
    expect(o.tip).toMatch(/suits your goal/);
    expect(`${o.observation} ${o.tip}`).not.toMatch(/\b(weak|undertrained|overtrained|lagging)\b/i);
    const down = pickObservation({
      ...base,
      coached: false,
      profile: "physique",
      muscles: [{ muscle: "Lats", role: "prime", total: 10, before: 20, changePct: -50 }],
    })!;
    expect(down.observation).toMatch(/50% fewer sets/);
    expect(`${down.observation} ${down.tip}`).not.toMatch(/\b(weak|undertrained|lagging)\b/i);
    // too little before it to compare: nothing said
    expect(
      pickObservation({
        ...base,
        muscles: [{ muscle: "Chest", role: "prime", total: 9, before: 3, changePct: 200 }],
      }),
    ).toBeNull();
  });
  it("an estimated max is said as an estimate", () => {
    const o = pickObservation({
      ...base,
      mainLift: "squat",
      liftTrends: {
        squat: {
          kind: "up",
          pct: 6.4,
          from: { day: "2026-10-01", value: 400, state: "measured", basis: "2026-10-01" },
          to: { day: "2026-11-20", value: 425.6, state: "measured", basis: "2026-11-20" },
        },
      },
    })!;
    expect(o.observation).toMatch(/squat strength is up 6.4%/);
    expect(o.basis).toBe("estimated");
  });
  it("a lighter phase reads lower volume as planned, never a regression", () => {
    const o = pickObservation({
      ...base,
      phase: "taper",
      setShifts: [{ lift: "bench", from: 12, to: 6, pct: -50 }],
      rpeShifts: [],
    })!;
    expect(o.observation).toMatch(/matches the lighter phase/);
  });
});

describe("blocks compared like with like", () => {
  it("names each block's type, marks the lighter ones planned, opens on the latest block's kind", () => {
    const strength = liftStrengths(
      [
        res("2026-06-05", { load: 400, reps: 3 }),
        res("2026-06-25", { load: 420, reps: 3 }),
        res("2026-08-05", { load: 420, reps: 3 }),
        res("2026-08-25", { load: 440, reps: 3 }),
      ],
      [],
      "2026-11-01",
    );
    const rows = blockRows({
      blocks: [
        { id: "a", name: "Block 1 — Strength", start_date: "2026-06-01", end_date: "2026-06-30" },
        { id: "b", name: "Taper", start_date: "2026-07-01", end_date: "2026-07-14" },
        { id: "c", name: "Block 3 — Strength", start_date: "2026-08-01", end_date: "2026-08-31" },
      ],
      strength,
      weeks: [],
      sets: [],
      today: "2026-11-01",
    });
    expect(rows.find((r) => r.id === "c")!.typeName).toBe("Strength");
    expect(rows.find((r) => r.id === "c")!.strengthPct.squat).toBeGreaterThan(0);
    expect(defaultBlockType(rows)).toBe("strength");
  });
});

describe("the 3D body", () => {
  it("is built from the app's own drawing: a closed, outward-facing mesh a tap can land on", async () => {
    const { bodyMesh, rayHit, viewWeights } = await import("@/lib/body3d/body-mesh");
    const { muscleOfSite, SITE_MUSCLE } = await import("@/lib/body3d/muscle-sites");
    const m = bodyMesh();
    expect(m.vertexCount).toBeGreaterThan(10_000);
    expect(m.triangleCount).toBeLessThan(80_000);
    // a ray from in front of the chest (drawing coords, z toward the viewer) lands on the front
    const hit = rayHit(m, [170, 230, 400], [0, 0, -1]);
    expect(hit).not.toBeNull();
    expect(hit!.n[2]).toBeGreaterThan(0.5);
    expect(viewWeights(hit!.p, hit!.n).front).toBeGreaterThan(0.8);
    // from behind it lands on the back
    const back = rayHit(m, [170, 300, -400], [0, 0, 1]);
    expect(back!.n[2]).toBeLessThan(-0.5);
    // every trained muscle has somewhere on the drawing
    expect(new Set(Object.values(SITE_MUSCLE)).size).toBe(16);
    expect(muscleOfSite("vmo")).toBe("Quads");
    expect(muscleOfSite("kneecap")).toBeNull();
  });
});
