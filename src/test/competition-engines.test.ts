import { describe, expect, it } from "vitest";
import {
  planMilestones,
  phaseFor,
  currentMilestone,
  type ExistingMilestone,
} from "@/lib/competition/milestones";
import {
  meetsFromOplCsv,
  parseCsv,
  slugCandidates,
  identityFit,
  resolveIdentity,
  slugFromUrl,
} from "@/lib/competition/opl";
import { attemptStats } from "@/lib/competition/meet-stats";
import { readCompetitor } from "@/lib/competition/competitor";
import { forecastMeet, type LiftEvidence } from "@/lib/competition/forecast";
import { buildLandscape } from "@/lib/competition/landscape";
import { planAttempts, planLiftAttempts, nextAllowed } from "@/lib/competition/attempts";
import { planWarmups, warmupHistory } from "@/lib/competition/warmups";
import { recommendCall, type CallInput } from "@/lib/competition/call";
import { ungroundedNumbers, numbersIn, bannedPhrases } from "@/lib/competition/grounding";
import { IPF_RULES, readRules, rulesFor } from "@/lib/competition/rules";
import { watchList, liftForPlace } from "@/lib/competition/watch";
import { competitionProfile } from "@/lib/competition/learning";
import { planGameDay } from "@/lib/competition/gameday";
import type { MeetRecord } from "@/lib/competition/types";

const HEAD =
  "Name,Sex,Event,Equipment,Age,Division,BodyweightKg,WeightClassKg,Squat1Kg,Squat2Kg,Squat3Kg,Best3SquatKg,Bench1Kg,Bench2Kg,Bench3Kg,Best3BenchKg,Deadlift1Kg,Deadlift2Kg,Deadlift3Kg,Best3DeadliftKg,TotalKg,Place,Dots,Goodlift,Tested,Country,Federation,ParentFederation,Date,MeetCountry,MeetState,MeetTown,MeetName";
const row = (o: Partial<Record<string, string | number>>) =>
  HEAD.split(",")
    .map((h) => {
      const v = o[h];
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") ? `"${s}"` : s;
    })
    .join(",");

function lifter(
  meets: Array<{
    date: string;
    name: string;
    s: number[];
    b: number[];
    d: number[];
    place?: string;
    bw?: number;
    cls?: string;
    fed?: string;
  }>,
): string {
  return [
    HEAD,
    ...meets.map((m) => {
      const best = (a: number[]) => Math.max(0, ...a.filter((x) => x > 0));
      const total = m.place === "DQ" ? "" : best(m.s) + best(m.b) + best(m.d);
      return row({
        Name: "Jane Doe",
        Sex: "F",
        Event: "SBD",
        Equipment: "Raw",
        Division: "Open",
        BodyweightKg: m.bw ?? 62.4,
        WeightClassKg: m.cls ?? "63",
        Squat1Kg: m.s[0],
        Squat2Kg: m.s[1],
        Squat3Kg: m.s[2],
        Best3SquatKg: best(m.s) || "",
        Bench1Kg: m.b[0],
        Bench2Kg: m.b[1],
        Bench3Kg: m.b[2],
        Best3BenchKg: best(m.b) || "",
        Deadlift1Kg: m.d[0],
        Deadlift2Kg: m.d[1],
        Deadlift3Kg: m.d[2],
        Best3DeadliftKg: best(m.d) || "",
        TotalKg: total,
        Place: m.place ?? "1",
        Tested: "Yes",
        Country: "Canada",
        Federation: m.fed ?? "CPU",
        Date: m.date,
        MeetCountry: "Canada",
        MeetName: m.name,
      });
    }),
  ].join("\n");
}

const JANE = lifter([
  {
    date: "2026-09-12",
    name: "Provincials, 2026",
    s: [140, 147.5, 152.5],
    b: [77.5, 82.5, -85],
    d: [170, 180, 187.5],
  },
  {
    date: "2026-03-08",
    name: "Westerns",
    s: [135, 142.5, -147.5],
    b: [75, 80, 82.5],
    d: [165, 175, -182.5],
  },
  {
    date: "2025-10-04",
    name: "Open",
    s: [130, 137.5, 142.5],
    b: [72.5, 77.5, -80],
    d: [160, 170, 177.5],
  },
]);

describe("milestones", () => {
  it("schedules every milestone for a meet 20 weeks out, recon today", () => {
    const ch = planMilestones({
      meetDate: "2027-04-10",
      today: "2026-11-21",
      status: "upcoming",
      existing: [],
    });
    const by = Object.fromEntries(ch.map((c) => [c.kind, c]));
    expect(by.recon).toMatchObject({ due_on: "2026-11-21", status: "scheduled" });
    expect(by.foundation.due_on).toBe("2027-01-16");
    expect(by.intel.due_on).toBe("2027-02-13");
    expect(by.forecast.due_on).toBe("2027-03-13");
    expect(by.game_plan.due_on).toBe("2027-03-27");
    expect(by.confirm.due_on).toBe("2027-04-03");
    expect(by.debrief.due_on).toBe("2027-04-12");
  });

  it("a meet added 10 days out starts on the game plan today and skips what's passed", () => {
    const ch = planMilestones({
      meetDate: "2026-12-04",
      today: "2026-11-24",
      status: "upcoming",
      existing: [],
    });
    const by = Object.fromEntries(ch.map((c) => [c.kind, c]));
    expect(by.recon).toBeUndefined();
    expect(by.game_plan).toMatchObject({ due_on: "2026-11-24", status: "scheduled" });
    expect(by.foundation.status).toBe("skipped");
    expect(by.intel.status).toBe("skipped");
    expect(by.forecast.status).toBe("skipped");
    expect(by.confirm).toMatchObject({ due_on: "2026-11-27", status: "scheduled" });
  });

  it("a meet added 5 days out goes straight to confirmation today", () => {
    const ch = planMilestones({
      meetDate: "2026-11-29",
      today: "2026-11-24",
      status: "upcoming",
      existing: [],
    });
    expect(ch.find((c) => c.kind === "confirm")).toMatchObject({
      due_on: "2026-11-24",
      status: "scheduled",
    });
    expect(ch.find((c) => c.kind === "game_plan")?.status).toBe("skipped");
  });

  it("a meet moved six weeks later redoes the game plan already written and moves the rest", () => {
    const existing: ExistingMilestone[] = [
      { kind: "foundation", status: "ready", due_on: "2026-09-12" },
      { kind: "intel", status: "ready", due_on: "2026-10-10" },
      { kind: "forecast", status: "ready", due_on: "2026-11-07" },
      { kind: "game_plan", status: "ready", due_on: "2026-11-21" },
      { kind: "confirm", status: "scheduled", due_on: "2026-11-28" },
      { kind: "debrief", status: "scheduled", due_on: "2026-12-07" },
    ];
    const ch = planMilestones({
      meetDate: "2027-01-16",
      today: "2026-11-24",
      status: "upcoming",
      existing,
    });
    const by = Object.fromEntries(ch.map((c) => [c.kind, c]));
    expect(by.game_plan).toMatchObject({ due_on: "2027-01-02", status: "scheduled" });
    expect(by.forecast).toMatchObject({ due_on: "2026-12-19", status: "scheduled" });
    expect(by.confirm.due_on).toBe("2027-01-09");
    expect(by.intel).toBeUndefined(); // done, and its new day is already past
  });

  it("a meet moved earlier makes the current phase due today", () => {
    const existing: ExistingMilestone[] = [
      { kind: "foundation", status: "ready", due_on: "2026-11-01" },
      { kind: "intel", status: "scheduled", due_on: "2026-11-29" },
      { kind: "forecast", status: "scheduled", due_on: "2026-12-27" },
      { kind: "game_plan", status: "scheduled", due_on: "2027-01-10" },
      { kind: "confirm", status: "scheduled", due_on: "2027-01-17" },
    ];
    const ch = planMilestones({
      meetDate: "2026-12-14",
      today: "2026-11-24",
      status: "upcoming",
      existing,
    });
    const by = Object.fromEntries(ch.map((c) => [c.kind, c]));
    expect(by.forecast).toMatchObject({ due_on: "2026-11-24", status: "scheduled" });
    expect(by.intel.status).toBe("skipped");
    expect(by.game_plan.due_on).toBe("2026-11-30");
  });

  it("a cancelled competition skips everything not done", () => {
    const ch = planMilestones({
      meetDate: "2027-01-16",
      today: "2026-11-24",
      status: "cancelled",
      existing: [{ kind: "intel", status: "scheduled", due_on: "2026-11-21" }],
    });
    expect(ch).toEqual([expect.objectContaining({ kind: "intel", status: "skipped" })]);
  });

  it("results in makes the debrief due now", () => {
    const ch = planMilestones({
      meetDate: "2026-11-22",
      today: "2026-11-24",
      status: "completed",
      existing: [{ kind: "confirm", status: "ready", due_on: "2026-11-15" }],
      hasResults: true,
    });
    expect(ch.find((c) => c.kind === "debrief")).toMatchObject({
      due_on: "2026-11-24",
      status: "scheduled",
    });
  });

  it("phases follow the days out", () => {
    expect(phaseFor(100)).toBe("reconnaissance");
    expect(phaseFor(84)).toBe("foundation");
    expect(phaseFor(20)).toBe("forecast");
    expect(phaseFor(0)).toBe("meet_day");
    expect(phaseFor(-1, 2)).toBe("meet_day");
    expect(phaseFor(-2, 2)).toBe("post_meet");
    expect(currentMilestone(13)).toBe("game_plan");
  });
});

describe("OpenPowerlifting", () => {
  it("reads a lifter CSV, newest first, misses negative", () => {
    const meets = meetsFromOplCsv(JANE);
    expect(meets).toHaveLength(3);
    expect(meets[0].name).toBe("Provincials, 2026");
    expect(meets[0].total).toBe(152.5 + 82.5 + 187.5);
    expect(meets[0].attempts?.b[2]).toBe(-85);
  });

  it("parses quoted cells", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([{ a: "x, y", b: 'he said "hi"' }]);
  });

  it("makes usernames from names and reads them from links", () => {
    expect(slugCandidates("Zoë O'Neil", 2)).toEqual(["zoeoneil", "zoeoneil1", "zoeoneil2"]);
    expect(slugFromUrl("https://www.openpowerlifting.org/u/janedoe1")).toBe("janedoe1");
  });

  it("only links an identity when one candidate clearly fits", () => {
    const meets = meetsFromOplCsv(JANE);
    const fit = identityFit(
      meets,
      "F",
      { sex: "F", federation: "CPU", weightClass: "63" },
      "2026-11-24",
    );
    expect(fit.score).toBeGreaterThanOrEqual(0.8);
    expect(identityFit(meets, "F", { sex: "M" }, "2026-11-24").score).toBe(0);
    expect(
      resolveIdentity([
        { slug: "janedoe", score: fit.score, why: [], meets: 3 },
        { slug: "janedoe1", score: 0.5, why: [], meets: 1 },
      ]).status,
    ).toBe("matched");
    expect(
      resolveIdentity([
        { slug: "janedoe", score: 0.6, why: [], meets: 3 },
        { slug: "janedoe1", score: 0.55, why: [], meets: 1 },
      ]).status,
    ).toBe("ambiguous");
    expect(resolveIdentity([]).status).toBe("not_found");
  });
});

describe("attempt stats and competitors", () => {
  const meets = meetsFromOplCsv(JANE);
  it("reads openers, success and jumps", () => {
    const s = attemptStats(meets);
    expect(s.meetsWithAttempts).toBe(3);
    expect(s.taken).toEqual([9, 9, 9]);
    expect(s.success[0]).toBe(1);
    expect(s.success[2]).toBeCloseTo(5 / 9, 2);
    expect(s.missesByLift.bench).toBe(2);
    // thirds a median ~3.6% over the second, 56% made: balanced
    expect(s.style).toBe("balanced");
  });

  it("projects from the recent level, not the lifetime best alone", () => {
    const r = readCompetitor({ meets, today: "2026-11-24", meetDate: "2027-03-01" });
    expect(r.recentTotal?.kg).toBe(422.5);
    expect(r.trendPerYear).toBeGreaterThan(0);
    expect(r.projection!.expected).toBeGreaterThan(422.5);
    expect(r.projection!.expected).toBeLessThan(422.5 * 1.06);
    expect(r.projection!.conservative).toBeLessThan(r.projection!.expected);
    expect(r.projection!.high).toBeGreaterThanOrEqual(r.projection!.expected);
    expect(r.confidence).toBe("high");
  });

  it("an observed heavier competition single only widens the high end", () => {
    const base = readCompetitor({ meets, today: "2026-11-24", meetDate: "2027-03-01" });
    const withObs = readCompetitor({
      meets,
      today: "2026-11-24",
      meetDate: "2027-03-01",
      observations: [
        {
          date: "2026-11-10",
          lift: "deadlift",
          exercise: "Deadlift",
          loadKg: 200,
          reps: 1,
          rpe: 9,
          standard: "competition",
          equipment: null,
          source: "instagram",
          url: null,
          confidence: "medium",
          note: null,
        },
      ],
    });
    expect(withObs.projection!.expected).toBe(base.projection!.expected);
    expect(withObs.projection!.high).toBeGreaterThan(base.projection!.high);
    // a variation never counts
    const variation = readCompetitor({
      meets,
      today: "2026-11-24",
      meetDate: "2027-03-01",
      observations: [
        {
          date: "2026-11-10",
          lift: "deadlift",
          exercise: "Block pull",
          loadKg: 230,
          reps: 1,
          rpe: null,
          standard: "variation",
          equipment: null,
          source: "caption",
          url: null,
          confidence: "medium",
          note: null,
        },
      ],
    });
    expect(variation.projection!.high).toBe(base.projection!.high);
  });
});

const ev = (
  lift: "squat" | "bench" | "deadlift",
  nowKg: number,
  extra: Partial<LiftEvidence> = {},
): LiftEvidence => ({
  lift,
  nowKg,
  state: "measured",
  basis: "test",
  basisDay: "2026-11-18",
  hardSessions6w: 4,
  trendPerWeek: 0,
  direction: "flat",
  ...extra,
});

describe("forecast", () => {
  const lifts = {
    squat: ev("squat", 160),
    bench: ev("bench", 87.5),
    deadlift: ev("deadlift", 195),
  };
  it("gives three scenarios on the increment with the total their sum", () => {
    const f = forecastMeet({
      today: "2026-11-24",
      meetDate: "2027-01-10",
      lifts,
      meets: [],
      conversion: [],
      concerns: [],
    });
    for (const l of ["squat", "bench", "deadlift"] as const) {
      const r = f.lifts[l]!.range;
      expect(r.conservative % 2.5).toBe(0);
      expect(r.conservative).toBeLessThan(r.expected);
      expect(r.high).toBeGreaterThan(r.expected);
    }
    expect(f.total!.expected).toBe(
      f.lifts.squat!.range.expected +
        f.lifts.bench!.range.expected +
        f.lifts.deadlift!.range.expected,
    );
    expect(f.limitations.join(" ")).toMatch(/conversion assumed/);
  });

  it("uses the athlete's own platform conversion and a rising line, capped", () => {
    const up = { ...lifts, squat: ev("squat", 160, { trendPerWeek: 0.02, direction: "up" }) };
    const f = forecastMeet({
      today: "2026-11-24",
      meetDate: "2027-03-01",
      lifts: up,
      meets: [],
      conversion: [
        { lift: "squat", meetDate: "2026-09-12", meetKg: 152.5, trainingKg: 148 },
        { lift: "squat", meetDate: "2026-03-08", meetKg: 142.5, trainingKg: 140 },
      ],
      concerns: [],
    });
    const sq = f.lifts.squat!;
    expect(sq.conversion.assumed).toBe(false);
    expect(sq.range.expected).toBeLessThanOrEqual(
      Math.round((160 * sq.conversion.ratio * 1.025) / 2.5) * 2.5,
    );
  });

  it("serious pain lowers that lift's conservative day and says so", () => {
    const a = forecastMeet({
      today: "2026-11-24",
      meetDate: "2027-01-10",
      lifts,
      meets: [],
      conversion: [],
      concerns: [],
    });
    const b = forecastMeet({
      today: "2026-11-24",
      meetDate: "2027-01-10",
      lifts,
      meets: [],
      conversion: [],
      concerns: [{ lift: "bench", severity: "serious", text: "Shoulder pain" }],
    });
    expect(b.lifts.bench!.range.conservative).toBeLessThan(a.lifts.bench!.range.conservative);
    expect(b.lifts.squat!.range.conservative).toBe(a.lifts.squat!.range.conservative);
  });

  it("falls back to a recent meet with low confidence when training says nothing", () => {
    const meets = meetsFromOplCsv(JANE);
    const f = forecastMeet({
      today: "2026-11-24",
      meetDate: "2027-01-10",
      lifts: {
        squat: ev("squat", 0, { nowKg: null, state: null }),
        bench: ev("bench", 87.5),
        deadlift: ev("deadlift", 195),
      },
      meets,
      conversion: [],
      concerns: [],
    });
    expect(f.lifts.squat!.source).toBe("meet");
    expect(f.confidence).toBe("low");
  });
});

describe("landscape and attempts", () => {
  const meets = meetsFromOplCsv(JANE);
  const jane = {
    id: "c1",
    name: "Jane Doe",
    read: readCompetitor({ meets, today: "2026-11-24", meetDate: "2027-01-10" }),
  };
  it("names the threat whose range reaches ours and what wins", () => {
    const l = buildLandscape({
      athlete: {
        total: { conservative: 410, expected: 425, high: 437.5 },
        lifts: {
          squat: { conservative: 150, expected: 155, high: 160 },
          bench: { conservative: 80, expected: 85, high: 87.5 },
          deadlift: { conservative: 180, expected: 185, high: 190 },
        },
        bestMeetTotal: 415,
        confidence: "medium",
      },
      competitors: [jane],
      objective: "win",
    });
    expect(l.biggest?.name).toBe("Jane Doe");
    expect(l.biggest?.overlaps).toBe(true);
    expect(l.toWin).toBeGreaterThan(jane.read.projection!.expected);
    expect(l.place?.best).toBe(1);
    expect(l.answers.map((a) => a.q)).toContain("Biggest threat");
  });

  it("attempts climb on the increment, opener under the conservative day", () => {
    const a = planLiftAttempts({
      lift: "squat",
      range: { conservative: 190, expected: 200, high: 207.5 },
      rules: IPF_RULES,
    });
    expect(a.opener % 2.5).toBe(0);
    expect(a.opener).toBeLessThanOrEqual(190 * 0.96);
    for (const p of Object.values(a.pathways)) {
      expect(p[1]).toBeGreaterThanOrEqual(p[0] + 2.5);
      expect(p[2]).toBeGreaterThanOrEqual(p[1] + 2.5);
      p.forEach((x) => expect(x % 2.5).toBe(0));
    }
    expect(a.pathways.balanced[2]).toBe(200);
    expect(a.pathways.aggressive[2]).toBeLessThanOrEqual(207.5);
    expect(a.contingencies[0].then).toMatch(/can't go lower/);
  });

  it("their own opener habit sets the opener, missed openers lower it", () => {
    const plan = planAttempts({
      lifts: {
        squat: { conservative: 190, expected: 200, high: 207.5 },
        bench: null,
        deadlift: null,
      },
      rules: IPF_RULES,
      history: attemptStats(meets),
    });
    expect(plan.lifts.squat!.why[0]).toMatch(/usually open/);
    expect(plan.totals.balanced).toBeNull();
    expect(nextAllowed(200, IPF_RULES, false)).toBe(200);
    expect(nextAllowed(200, IPF_RULES, true)).toBe(202.5);
  });
});

describe("warm-ups", () => {
  it("ramps to a last warm-up under the opener, timed backwards", () => {
    const w = planWarmups({ lift: "squat", openerKg: 180 });
    expect(w.sets[0].kg).toBe(20);
    expect(w.last.kg).toBeLessThan(180);
    expect(w.sets.every((s, i) => i === 0 || s.kg > w.sets[i - 1].kg)).toBe(true);
    expect(w.sets[w.sets.length - 1].minutesBefore).toBe(8);
    expect(w.individual).toBe(false);
  });
  it("follows their own habit when there's enough of it", () => {
    const h = warmupHistory([
      { warmups: [60, 100, 130, 150], firstWorkingKg: 165 },
      { warmups: [60, 100, 130, 152.5], firstWorkingKg: 165 },
      { warmups: [60, 100, 135, 155], firstWorkingKg: 170 },
    ]);
    expect(h.sessions).toBe(3);
    const w = planWarmups({ lift: "squat", openerKg: 180, history: h });
    expect(w.individual).toBe(true);
    expect(w.sets.length).toBeLessThanOrEqual(5);
    expect(w.last.pct).toBeCloseTo(0.91, 1);
  });
});

describe("strategy calls", () => {
  const base: CallInput = {
    milestone: "intel",
    level: "local",
    firstMeet: false,
    objective: "pb_total",
    closeField: false,
    qualificationOnLine: false,
    weightClassUndecided: false,
    projectionShift: 0,
    concerns: 0,
    expectationGap: null,
    complexAttempts: false,
    lastCallDaysAgo: null,
    upcomingCallOn: null,
    includedCallsLeft: null,
    packageName: "Complete Online Coaching",
  };
  it("a routine local meet for an experienced athlete needs no call", () => {
    const r = recommendCall(base);
    expect(r.recommend).toBe(false);
    expect(r.coverage.kind).toBe("not_included");
  });
  it("an international game plan with a close field recommends one, and says what's included", () => {
    const r = recommendCall({
      ...base,
      milestone: "game_plan",
      level: "international",
      objective: "podium",
      closeField: true,
      complexAttempts: true,
      includedCallsLeft: 1,
    });
    expect(r.recommend).toBe(true);
    expect(r.minutes).toBeGreaterThanOrEqual(30);
    expect(r.coverage.kind).toBe("included");
  });
  it("never recommends a call when one is booked or they just spoke", () => {
    expect(
      recommendCall({
        ...base,
        milestone: "game_plan",
        level: "international",
        upcomingCallOn: "2026-12-01",
      }).recommend,
    ).toBe(false);
    expect(
      recommendCall({
        ...base,
        milestone: "game_plan",
        level: "national",
        firstMeet: true,
        lastCallDaysAgo: 4,
      }).recommend,
    ).toBe(false);
  });
});

describe("grounding, rules, watch, learning, game day", () => {
  it("flags numbers the brief doesn't have and allows conversions", () => {
    const allowed = numbersIn({ total: 600, dl: 250, pct: 0.91 });
    expect(
      ungroundedNumbers("Expected 600 kg (1322.8 lb), opener at 91%, 3 attempts in 2027", allowed),
    ).toEqual([]);
    expect(ungroundedNumbers("They'll pull 265 kg", allowed)).toEqual([265]);
    expect(bannedPhrases("a 70% chance to win")).toHaveLength(1);
    expect(bannedPhrases("do a water cut")).toHaveLength(1);
  });
  it("starts IPF affiliates on IPF rules, unconfirmed, and reads stored rules safely", () => {
    expect(rulesFor("CPU").family).toBe("ipf");
    expect(rulesFor("CanPL").family).toBe("ipf");
    expect(rulesFor("USPA").weighInHours).toBe(24);
    expect(rulesFor("CPU").confirmed).toBe(false);
    expect(readRules({ incrementKg: 999, confirmed: true }, "CPU")).toMatchObject({
      incrementKg: 2.5,
      confirmed: true,
    });
  });
  it("puts serious concerns first", () => {
    const w = watchList({
      daysOut: 20,
      meetDate: "2026-12-14",
      programEndsOn: "2026-11-30",
      peakCovered: false,
      bodyweightAvg: 64.6,
      bodyweightTrendPerWeek: 0.1,
      classLimit: 63,
      pain: [{ place: "Left shoulder", lift: "bench", worse: true, score: 6 }],
      recoveryFlags: 1,
      adherence: 0.9,
      expectedTotal: 400,
      targetTotal: 420,
      cardioMinutesPerWeek: 60,
      missing: ["Weight class"],
    });
    expect(w[0].severity).toBe("serious");
    expect(w.map((x) => x.key)).toEqual(
      expect.arrayContaining([
        "program:ends",
        "program:peak",
        "bodyweight:over",
        "pain:Left shoulder",
        "forecast:short",
        "info:Weight class",
      ]),
    );
    expect(liftForPlace("Right knee")).toBe("squat");
    expect(liftForPlace("Left pec")).toBe("bench");
  });
  it("labels learned patterns proven only with three meets", () => {
    const p = competitionProfile({
      meets: meetsFromOplCsv(JANE),
      conversion: [],
      checks: [{ meetDate: "2026-09-12", lift: "total", predicted: 440, actual: 422.5 }],
      warmups: {},
    });
    expect(p.patterns.find((x) => x.key === "thirds")?.evidence).toBe("proven");
    expect(p.forecastBias).toBeGreaterThan(0);
    expect(p.patterns.find((x) => x.key === "forecast")?.text).toMatch(/ran high/);
  });
  it("lays out the day from the lifting start with a 2-hour weigh-in", () => {
    const d = planGameDay({ rules: IPF_RULES, liftingStart: "10:00" });
    expect(d.find((s) => s.title.startsWith("Weigh in"))?.at).toBe("08:00");
    expect(d.find((s) => s.title === "Squat")?.at).toBe("10:00");
    expect(JSON.stringify(d)).not.toMatch(/dehydrat|water load/i);
  });
});
