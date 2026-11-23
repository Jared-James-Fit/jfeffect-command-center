/**
 * Workouts & Training analytics, Nov 22 2026: fewer taps, one period control,
 * goal-specific Overview, and numbers that say what they are.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  bucketPoints,
  CURRENT_DAYS,
  grainFor,
  meetDay,
  meetsFromRows,
  relativeToBodyweight,
  strengthPoints,
  totalStanding,
} from "@/lib/analytics/competition-strength";
import {
  buildTrainingLoad,
  perWeekWords,
  type LoadSet,
  type PlanRow,
} from "@/lib/analytics/training-load";
import {
  recoverySummary,
  sleepPatternInsight,
  type CheckoutRow,
} from "@/lib/analytics/recovery-trends";
import { analyticsProfile } from "@/lib/analytics/analytics-profile";
import { weekParts } from "@/components/workouts/program-roadmap";
import {
  filterFromSearch,
  lastNWeeks,
  searchFromFilter,
} from "@/components/analytics/analytics-filter-bar";
import { pickRecommendation } from "@/lib/analytics/readiness-factors";

const res = (
  day: string,
  lift: string,
  load: number,
  reps: number,
  rpe: string | null,
  comp = true,
) => ({
  date: `${day}T18:00:00`,
  is_competition_lift: comp,
  competition_lift_type: lift,
  load,
  reps,
  rpe,
  rir: null,
});

describe("competition strength: estimates, meets and training maxes stay apart", () => {
  it("plots only hard sets of the competition lift (RPE 7+, ≤10 reps), never a variation or a light day", () => {
    const { points, light } = strengthPoints([
      res("2026-11-16", "squat", 455, 1, "6"), // a light single
      res("2026-11-16", "squat", 375, 4, "6"),
      res("2026-10-26", "squat", 335, 5, "8"),
      res("2026-10-26", "bench", 280, 5, "8", false), // a variation
      res("2026-10-20", "bench", 200, 12, "9"), // too many reps
    ]);
    expect(points.map((p) => [p.lift, p.day])).toEqual([["squat", "2026-10-26"]]);
    // 335 × (1 + (5 + 2) / 30): Epley on the reps done plus the reps left
    expect(points[0].e1rm).toBeCloseTo(413.2, 1);
    // counted, never plotted: the 12-rep bench and the RPE 6 squat day
    expect(light.map((l) => l.day)).toEqual(["2026-10-20", "2026-11-16"]);
  });

  it("a current total only when all three lifts have a hard set in the last 6 weeks (the Nov 22 records)", () => {
    // Jared's own: squat 335×5@8 Oct 26, deadlift 495×4@10 Nov 13, every bench set since Sep 21 at RPE 6
    const { points } = strengthPoints([
      res("2026-09-21", "bench", 330.7, 1, "8"),
      res("2026-10-26", "squat", 335, 5, "8"),
      res("2026-11-13", "deadlift", 495, 4, "10"),
      res("2026-11-19", "bench", 280, 1, "6"),
    ]);
    const meets = meetsFromRows([
      {
        meet_date: "2026-09-18",
        meet_name: "Commonwealth Championships",
        squat_kg: 235,
        bench_kg: 150,
        deadlift_kg: 270,
        bodyweight_kg: 65.4,
      },
    ]);
    const st = totalStanding({
      points,
      meets,
      trainingMaxes: { deadlift: { lb: 600, date: "2026-10-07" } },
      today: "2026-11-22",
    });
    expect(st.lifts.squat.current?.lb).toBeCloseTo(413.2, 1);
    expect(st.lifts.deadlift.current?.lb).toBeCloseTo(561, 0);
    expect(st.lifts.bench.current).toBeNull();
    expect(st.lifts.bench.latest?.day).toBe("2026-09-21");
    expect(st.missing).toEqual(["bench"]);
    expect(st.currentTotal).toBeNull();
    expect(st.vsMeet).toBeNull();
    // the coach's training max is listed, never used as the athlete's estimate
    expect(st.lifts.deadlift.trainingMax?.lb).toBe(600);
    expect(Math.round(st.lastMeet!.total)).toBe(1444);
    expect(CURRENT_DAYS).toBe(42);
  });

  it("a meet's date is that calendar day (Sep 18 never reads as Sep 17)", () => {
    const [m] = meetsFromRows([
      { meet_date: "2026-09-18", squat_kg: 1, bench_kg: 1, deadlift_kg: 1 },
    ]);
    const d = meetDay(m)!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 18]);
  });

  it("long periods read the week's or month's best, never an average", () => {
    expect(grainFor(84)).toBe("session");
    expect(grainFor(365)).toBe("week");
    expect(grainFor(900)).toBe("month");
    const pts = [
      {
        lift: "squat" as const,
        day: "2026-11-16",
        e1rm: 400,
        set: { load: 1, reps: 1, effort: 8 },
      },
      {
        lift: "squat" as const,
        day: "2026-11-19",
        e1rm: 420,
        set: { load: 1, reps: 1, effort: 8 },
      },
    ];
    expect(bucketPoints(pts, "week").map((p) => p.e1rm)).toEqual([420]);
  });

  it("× bodyweight uses that week's weigh-ins and leaves a point out with none near it", () => {
    const out = relativeToBodyweight(
      [
        { day: "2026-11-10", value: 450 },
        { day: "2026-06-01", value: 400 },
      ],
      [
        { day: "2026-11-08", lb: 150 },
        { day: "2026-11-10", lb: 150 },
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(3);
  });
});

const set = (day: string, extra: Partial<LoadSet> = {}): LoadSet => ({
  day,
  dayId: `d-${day}`,
  rowId: `r-${day}`,
  exerciseId: "e",
  exercise: "Competition Squat",
  primary: ["Quads"],
  secondary: [],
  fallbackMuscle: null,
  countsTowardVolume: true,
  category: "Compound",
  rowFamily: "squat",
  competitionLiftType: "squat",
  isCompetitionLift: true,
  exerciseFamily: "squat",
  dbPattern: "squat",
  reps: 5,
  loadKg: 150,
  rpe: 7,
  rir: null,
  ...extra,
});
const planRow = (day: string, sets: number): PlanRow =>
  ({
    rowId: `p-${day}`,
    dayId: `pd-${day}`,
    day,
    exerciseId: "e",
    exercise: "Competition Squat",
    primary: ["Quads"],
    secondary: [],
    fallbackMuscle: null,
    countsTowardVolume: true,
    category: "Compound",
    rowFamily: "squat",
    competitionLiftType: "squat",
    isCompetitionLift: true,
    exerciseFamily: "squat",
    dbPattern: "squat",
    sets,
  }) as PlanRow;

describe("working sets a week never divide by weeks that haven't happened", () => {
  it("a block's first week reads as this week so far (37 sets read as 9.3 a week before)", () => {
    const sets = Array.from({ length: 37 }, (_, i) =>
      set(`2026-11-${String(16 + (i % 4)).padStart(2, "0")}`),
    );
    const plan = ["2026-11-23", "2026-11-30", "2026-12-07"].map((d) => planRow(d, 10));
    const load = buildTrainingLoad({
      sets,
      plan,
      today: "2026-11-22",
      range: { start: "2026-11-15", end: "2026-12-12" },
    });
    expect(load.totals.setsPerWeek).toBe(37);
    expect(load.perWeekBasis).toEqual({ weeks: 0, partial: true });
    expect(perWeekWords(load).label).toBe("this week so far");
    expect(load.weeks.filter((w) => w.future).length).toBe(3);
  });

  it("a week off between two weeks of training counts as zero, never skipped", () => {
    const sets = [
      ...Array.from({ length: 10 }, () => set("2026-11-02")),
      ...Array.from({ length: 10 }, () => set("2026-11-16")),
    ];
    const load = buildTrainingLoad({ sets, today: "2026-11-25" });
    // weeks of Nov 2, Nov 9 (nothing), Nov 16 are over: 20 / 3
    expect(load.perWeekBasis).toEqual({ weeks: 3, partial: false });
    expect(load.totals.setsPerWeek).toBeCloseTo(6.7, 1);
  });

  it("counts the planned workouts that have passed and how many were trained", () => {
    const load = buildTrainingLoad({
      sets: [set("2026-11-16", { dayId: "pd-2026-11-16" })],
      plan: [planRow("2026-11-16", 3), planRow("2026-11-18", 3), planRow("2026-11-30", 3)],
      today: "2026-11-22",
    });
    expect(load.totals.plannedSessions).toBe(2);
    expect(load.totals.plannedSessionsDone).toBe(1);
  });
});

const row = (
  day: string,
  sleep: CheckoutRow["sleepBucket"],
  rating: number | null,
): CheckoutRow => ({ day, sleepBucket: sleep, recovery: 4, pain: false, rating, logging: 100 });

describe("sleep: a pattern only when there is one", () => {
  it("says nothing when the two groups slept the same (the 7.5h / 7.5h insight)", () => {
    const rows = [
      ...["01", "02", "03", "04"].map((d) => row(`2026-11-${d}`, "7_8", 5)),
      ...["05", "06", "07", "08"].map((d) => row(`2026-11-${d}`, "7_8", 3)),
    ];
    expect(sleepPatternInsight(rows)).toBeNull();
  });
  it("names a real gap as a pattern, never a cause", () => {
    const rows = [
      ...["01", "02", "03", "04"].map((d) => row(`2026-11-${d}`, "8_9", 5)),
      ...["05", "06", "07", "08"].map((d) => row(`2026-11-${d}`, "5_6", 2)),
    ];
    expect(sleepPatternInsight(rows)).toMatch(/not proof/);
  });
  it("needs enough of each group", () => {
    expect(
      sleepPatternInsight([row("2026-11-01", "8_9", 5), row("2026-11-02", "5_6", 2)]),
    ).toBeNull();
    expect(recoverySummary([row("2026-11-01", "7_8", 4)]).sleepAvg).toBe(7.5);
  });
});

describe("goal-specific overview", () => {
  it("what they train beats what a form said", () => {
    expect(
      analyticsProfile({
        mainGoal: "Lose body fat",
        styles: ["Bodybuilding"],
        compSessions12w: 10,
      }),
    ).toBe("powerlifting");
    expect(analyticsProfile({ mainGoal: "Build muscle", styles: [], compSessions12w: 0 })).toBe(
      "physique",
    );
    expect(
      analyticsProfile({ mainGoal: "Improve general fitness", styles: [], compSessions12w: 0 }),
    ).toBe("general");
    expect(
      analyticsProfile({ mainGoal: null, styles: null, compSessions12w: 0, hasMeet: true }),
    ).toBe("powerlifting");
  });
});

describe("the roadmap says each week once", () => {
  it("drops a 'Week 2 ·' the label already carries", () => {
    expect(weekParts({ index: 1, label: "Week 1 · Calibration" })).toEqual({
      number: 1,
      name: "Calibration",
    });
    expect(weekParts({ index: 1, label: "Week 5 - Intensification" })).toEqual({
      number: 5,
      name: "Intensification",
    });
    expect(weekParts({ index: 3, label: "Deload" })).toEqual({ number: 3, name: "Deload" });
    expect(weekParts({ index: 2, label: null })).toEqual({ number: 2, name: null });
  });
});

describe("the period", () => {
  it("6 months and 1 year exist and round-trip through the address", () => {
    const y = lastNWeeks(52);
    expect(y.short).toBe("1 year");
    expect(y.range).toMatch(/^since /);
    expect(searchFromFilter(y)).toEqual({ filter: "last_52w", blockId: "" });
    expect(filterFromSearch("last_26w", "", []).short).toBe("6 months");
    expect(filterFromSearch("", "", []).short).toBe("12 weeks");
  });
});

describe("readiness never says go heavier", () => {
  it("a clean read says train as planned", () => {
    const factors = Object.fromEntries(
      ["sleep", "recovery", "load", "consistency", "performance", "pain"].map((k) => [
        k,
        { key: k, score: 95, isMissing: false },
      ]),
    ) as any;
    expect(pickRecommendation(factors, null)).toBe(
      "Nothing stands out in what you logged. Train as planned.",
    );
  });
});

describe("the screens", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("analytics: one period control, no repeated period labels, no tonnage-led insights card", () => {
    const dash = read("src/components/analytics/client-analytics-dashboard.tsx");
    expect(dash).toContain("<AnalyticsPeriodControl");
    expect(dash).not.toContain("<AnalyticsFilterBar");
    expect(dash).not.toContain("<PerformanceInsights");
    expect(dash).not.toContain("meta={filter.label}");
    expect(dash).not.toMatch(/ATPR/);
    expect(dash).not.toContain("Top e1RM gain");
    // records are judged against the whole history, then cut to the period
    expect(dash).toContain("personalRecords(allResults as any[], meets)");
    expect(dash).toContain("records.filter((r) => r.day >= startDay && r.day <= endDay)");
  });
  it("workouts: analytics one tap from the header and the whole Performance card; no fold", () => {
    const wo = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(wo).toContain("data-header-analytics");
    expect(wo).toContain("<PerformanceCard");
    const card = read("src/components/performance-card.tsx");
    expect(card).toContain('to="/portal/workouts/analytics"');
    expect(card).not.toContain("Collapsible");
    expect(card).not.toContain("More about");
  });
  it("the program card is a compact summary; its phases are the full plan's, never a Plan details fold", () => {
    const card = read("src/components/workouts/program-roadmap.tsx");
    expect(card).toContain("data-program-phase");
    expect(card).not.toContain("data-roadmap-timeline");
    expect(card).not.toContain("Plan details");
    expect(card).toContain("ProgramPlanSheet");
  });
  it("readiness is a status, never a precise percentage", () => {
    const r = read("src/components/analytics/recovery-preview-card.tsx");
    expect(r).not.toContain("function ReadinessRing");
    expect(r).not.toMatch(/\{pct\}%/);
  });
});
