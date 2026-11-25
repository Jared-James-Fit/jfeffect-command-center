import { describe, expect, it } from "vitest";
import {
  formShare,
  forecastMeet,
  pastCuts,
  recentForm,
  FORM_MAX_SHARE,
  type ConversionPoint,
  type LiftEvidence,
} from "@/lib/competition/forecast";
import { readCompetitor, ACTIVE_MONTHS } from "@/lib/competition/competitor";
import type { MeetRecord } from "@/lib/competition/types";

/**
 * The case that exposed these rules (Nov 25 2026, an internal validation on
 * the coach's own record, anonymized): three 66 kg meets this year at 655 to
 * 662.5, eleven weeks out from Nationals, in an off-season RPE 6 volume block
 * at 75.6 kg with the bench last trained hard two months ago. The forecast
 * multiplied that line by a conversion measured three weeks out (where his
 * cut is already in it) and called him a 612.5 kg lifter.
 */
const meet = (
  date: string,
  weightClass: string,
  bodyweight: number,
  s: number,
  b: number,
  d: number,
): MeetRecord => ({
  date,
  name: "Meet",
  federation: "CPU",
  equipment: "Raw",
  event: "SBD",
  division: "Open",
  weightClass,
  bodyweight,
  squat: s,
  bench: b,
  deadlift: d,
  total: s + b + d,
  place: "1",
  attempts: null,
});
const MEETS: MeetRecord[] = [
  meet("2026-09-18", "66", 65.4, 235, 150, 270),
  meet("2026-08-03", "66", 65.7, 242.5, 152.5, 265),
  meet("2026-03-14", "66", 65.4, 240, 150, 272.5),
  meet("2025-03-01", "74", 73.8, 265, 172.5, 270),
];
const line = (
  nowKg: number,
  state: LiftEvidence["state"],
  basisDay: string,
  hard: number,
): LiftEvidence => ({
  lift: "squat",
  nowKg,
  state,
  basis: null,
  basisDay,
  hardSessions6w: hard,
  trendPerWeek: null,
  direction: "flat",
});
const CONVERSION: ConversionPoint[] = [
  { lift: "squat", meetDate: "2026-09-18", meetKg: 235, trainingKg: 255 },
  { lift: "squat", meetDate: "2026-08-03", meetKg: 242.5, trainingKg: 246.7 },
  { lift: "bench", meetDate: "2026-09-18", meetKg: 150, trainingKg: 162.2 },
  { lift: "bench", meetDate: "2026-08-03", meetKg: 152.5, trainingKg: 163.9 },
  { lift: "deadlift", meetDate: "2026-09-18", meetKg: 270, trainingKg: 300 },
  { lift: "deadlift", meetDate: "2026-08-03", meetKg: 265, trainingKg: 291.3 },
];
const lifts = {
  squat: { ...line(231.3, "measured", "2026-11-09", 3), lift: "squat" as const },
  bench: { ...line(157.2, "stale", "2026-09-13", 0), lift: "bench" as const },
  deadlift: { ...line(270, "held", "2026-11-13", 1), lift: "deadlift" as const },
};

describe("the forecast reads where the athlete is in the prep", () => {
  it("weighs recent platform form more the further away the meet is", () => {
    expect(formShare(21, 3)).toBe(0);
    expect(formShare(14, 3)).toBe(0);
    expect(formShare(84, 3)).toBeCloseTo(FORM_MAX_SHARE);
    expect(formShare(120, 3)).toBeCloseTo(FORM_MAX_SHARE);
    expect(formShare(75, 3)).toBeGreaterThan(0.6);
    // fewer meets carry less
    expect(formShare(84, 1)).toBeLessThan(formShare(84, 2));
    expect(formShare(84, 0)).toBe(0);
  });

  it("reads form only from the class they're entering, within a year", () => {
    const f = recentForm(MEETS, "squat", "2026-11-25", "66");
    expect(f?.kg).toBe(240);
    expect(f?.meets).toHaveLength(3);
    // the 74 kg meet isn't 66 kg form
    expect(recentForm(MEETS, "bench", "2026-11-25", "74")).toBeNull();
    // with no class, the latest three of the year
    expect(recentForm(MEETS, "bench", "2026-11-25", null)?.kg).toBe(150);
  });

  it("no longer calls a 655–662.5 kg lifter a 612.5 kg one eleven weeks out", () => {
    const f = forecastMeet({
      today: "2026-11-25",
      meetDate: "2027-02-08",
      lifts,
      meets: MEETS,
      conversion: CONVERSION,
      concerns: [],
      weightClass: "66",
    });
    // training alone said ~612.5; recent form at 66 kg is ~660
    expect(f.total!.expected).toBeGreaterThanOrEqual(635);
    expect(f.total!.expected).toBeLessThanOrEqual(665);
    // the range holds both reads: the conservative stays near the training line
    expect(f.total!.conservative).toBeLessThan(615);
    expect(f.total!.high).toBeGreaterThanOrEqual(660);
    expect(f.lifts.squat!.basis.join(" ")).toMatch(/Recent form at 66 kg: 240 kg/);
    expect(f.lifts.squat!.basis.join(" ")).toMatch(/weeks out: recent meets carry/);
    // a stale bench beside three meets of form isn't "low" any more
    expect(f.lifts.bench!.confidence).toBe("medium");
  });

  it("three weeks out it reads training exactly as before", () => {
    const base = {
      today: "2027-01-18",
      meetDate: "2027-02-08",
      lifts,
      meets: MEETS,
      conversion: CONVERSION,
      concerns: [],
    };
    const withClass = forecastMeet({ ...base, weightClass: "66" });
    const without = forecastMeet({ ...base, meets: [] });
    expect(withClass.lifts.squat!.range).toEqual(without.lifts.squat!.range);
  });
});

describe("past cuts: how far from the class they were at the same distance before", () => {
  it("averages weigh-ins around the same days-out before each meet", () => {
    const logs: Array<{ day: string; kg: number }> = [];
    // ~70 kg through the summer, 75.6 now
    for (let d = 1; d <= 30; d++)
      logs.push({ day: `2026-07-${String(d).padStart(2, "0")}`, kg: 70.2 });
    for (let d = 1; d <= 31; d++)
      logs.push({ day: `2026-05-${String(d).padStart(2, "0")}`, kg: 70.4 });
    for (let d = 1; d <= 30; d++)
      logs.push({ day: `2026-06-${String(d).padStart(2, "0")}`, kg: 70.6 });
    for (let d = 1; d <= 25; d++)
      logs.push({ day: `2026-11-${String(d).padStart(2, "0")}`, kg: 75.6 });
    const cuts = pastCuts(logs, MEETS, 75, "2026-11-25");
    const aug = cuts.find((c) => c.meetDate === "2026-08-03")!;
    expect(aug.sameDistanceKg).toBeCloseTo(70.5, 0);
    expect(aug.fourWeeksKg).toBeCloseTo(70.2, 1);
    expect(aug.weighInKg).toBe(65.7);
    // a meet with no weigh-ins around it says nothing rather than guessing
    expect(cuts.find((c) => c.meetDate === "2025-03-01")).toBeUndefined();
  });
});

describe("competitors: a trend is credited only while they're competing", () => {
  const climber: MeetRecord[] = [
    meet("2025-08-14", "66", 65.8, 235, 147.5, 318),
    meet("2025-03-01", "66", 65.9, 230, 145, 305),
    meet("2024-08-01", "66", 65.5, 225, 140, 295),
    meet("2024-03-01", "66", 65.6, 220, 137.5, 285),
  ];
  it("someone with no meet in fifteen months isn't projected past their last total", () => {
    const r = readCompetitor({ meets: climber, today: "2026-11-25", meetDate: "2027-02-08" });
    expect(r.projection!.expected).toBeLessThanOrEqual(702.5);
    expect(r.projection!.expected).toBeGreaterThanOrEqual(697.5);
    // the chance they kept climbing stays in the high scenario
    expect(r.projection!.high).toBeGreaterThan(r.projection!.expected + 10);
    expect(r.basis.join(" ")).toMatch(/trend isn't carried on without a meet/);
  });
  it("someone still competing keeps half their trend", () => {
    const recent = climber.map((m) => ({
      ...m,
      date: m.date.replace("2025", "2026").replace("2024", "2025"),
    }));
    const r = readCompetitor({ meets: recent, today: "2026-11-25", meetDate: "2027-02-08" });
    expect(ACTIVE_MONTHS).toBe(9);
    expect(r.projection!.expected).toBeGreaterThan(702.5);
  });
});
