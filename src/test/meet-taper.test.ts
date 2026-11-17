import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  liftTargets,
  pastMeetTapers,
  planLiftTaper,
  TAPER_WINDOWS,
  type LiftSet,
  type TaperSession,
} from "@/lib/workouts/meet-taper";

// Jared McIntyre's competition-lift sets of 1–3 reps, Jul–Sep 2026, as logged
// (kg, the day's heaviest, its lowest rep count and the RPE of its single or
// triple). The NAPF meet is Aug 5, the Sep meet Sep 20 (logged Sep 21).
const raw: Array<[string, "squat" | "bench" | "deadlift", number, number, number]> = [
  ["2026-07-06", "deadlift", 210, 3, 7.5], ["2026-07-06", "squat", 200, 3, 7],
  ["2026-07-10", "bench", 142.5, 1, 8], ["2026-07-10", "deadlift", 220, 3, 8.5], ["2026-07-10", "squat", 210, 3, 8],
  ["2026-07-13", "deadlift", 230, 3, 8], ["2026-07-13", "squat", 200, 3, 7.5],
  ["2026-07-18", "bench", 140, 1, 8.5], ["2026-07-18", "deadlift", 250, 3, 8], ["2026-07-18", "squat", 200, 3, 8],
  ["2026-07-20", "deadlift", 238.1, 3, 7], ["2026-07-20", "squat", 192.5, 3, 8],
  ["2026-07-26", "bench", 147.5, 1, 8.5], ["2026-07-26", "deadlift", 250, 3, 7], ["2026-07-26", "squat", 225, 3, 9],
  ["2026-07-27", "bench", 100, 3, 5], ["2026-07-27", "deadlift", 210, 2, 5], ["2026-07-27", "squat", 170, 3, 5],
  ["2026-08-01", "bench", 100, 3, 5], ["2026-08-01", "deadlift", 120, 2, 5], ["2026-08-01", "squat", 100, 3, 5],
  ["2026-08-03", "bench", 110, 1, 6], ["2026-08-03", "deadlift", 170, 1, 6], ["2026-08-03", "squat", 120, 1, 6],
  ["2026-08-05", "bench", 152.5, 1, 9], ["2026-08-05", "deadlift", 265, 1, 8.5], ["2026-08-05", "squat", 242.5, 1, 9],
  ["2026-08-21", "bench", 130, 1, 8.5], ["2026-08-21", "deadlift", 220, 2, 8.5], ["2026-08-21", "squat", 200, 2, 8],
  ["2026-08-30", "bench", 124.7, 1, 8.5], ["2026-08-30", "deadlift", 183.7, 2, 8.5], ["2026-08-30", "squat", 142.9, 2, 8.5],
  ["2026-09-07", "bench", 115.7, 2, 6], ["2026-09-07", "deadlift", 226.8, 2, 6], ["2026-09-07", "squat", 183.7, 2, 6],
  ["2026-09-13", "bench", 149.7, 1, 9.5], ["2026-09-13", "deadlift", 247.2, 1, 8.5], ["2026-09-13", "squat", 231.3, 1, 9],
  ["2026-09-14", "bench", 83.9, 2, 5], ["2026-09-14", "deadlift", 183.7, 1, 5], ["2026-09-14", "squat", 124.7, 2, 4],
  ["2026-09-18", "bench", 79.4, 1, 4], ["2026-09-18", "deadlift", 142.9, 1, 4], ["2026-09-18", "squat", 102.1, 1, 4],
  ["2026-09-21", "bench", 150, 1, 8], ["2026-09-21", "deadlift", 270, 1, 8], ["2026-09-21", "squat", 235, 1, 8],
];
const sets: LiftSet[] = raw.map(([date, lift, kg, reps, rpe]) => ({ date, lift, kg, reps, rpe }));

describe("past meets from the logs", () => {
  const meets = pastMeetTapers(sets, ["2026-09-20"]);

  it("finds both meets, the Sep one counted from its tested date", () => {
    expect(meets.map((m) => m.date)).toEqual(["2026-08-05", "2026-09-20"]);
  });

  it("never mistakes a heavy training day for a meet", () => {
    expect(meets.find((m) => m.date === "2026-09-13")).toBeUndefined();
  });

  it("reads each lift's last heavy exposure and how well it peaked", () => {
    const aug = meets[0].lifts;
    expect(aug.squat?.lastHeavy?.daysOut).toBe(10);
    expect(aug.bench?.lastHeavy?.daysOut).toBe(10);
    const sep = meets[1].lifts;
    expect(sep.squat?.lastHeavy?.daysOut).toBe(7);
    expect(sep.deadlift?.lastHeavy?.daysOut).toBe(7);
    // every lift peaked better off a final heavy 10 days out (August) than 7 (September)
    for (const lift of ["squat", "bench", "deadlift"] as const) expect(aug[lift]!.peak!).toBeGreaterThan(sep[lift]!.peak!);
  });
});

describe("each lift's own target", () => {
  const meets = pastMeetTapers(sets, ["2026-09-20"]);
  const written = { squat: 14, bench: 11, deadlift: 9 };

  it("with two meets (low confidence) it moves at most halfway toward history", () => {
    const t = liftTargets({ meets, writtenDaysOut: written });
    const by = Object.fromEntries(t.map((x) => [x.lift, x]));
    expect(t.map((x) => x.historyDaysOut)).toEqual([10, 10, 10]);
    expect(by.squat.daysOut).toBe(12); // 14 → halfway to 10
    expect(by.bench.daysOut).toBe(11); // 11 → 10 is less than a day's half step
    expect(by.deadlift.daysOut).toBe(9);
    expect(t.every((x) => x.confidence === "low")).toBe(true);
  });

  it("a lift whose TM work keeps running hard gets more room", () => {
    const t = liftTargets({ meets, writtenDaysOut: written, slowLifts: ["deadlift"] });
    expect(t.find((x) => x.lift === "deadlift")!.daysOut).toBe(11);
  });

  it("with no meets it keeps what's written, inside each window", () => {
    const t = liftTargets({ meets: [], writtenDaysOut: written });
    expect(t.map((x) => x.daysOut)).toEqual([14, 11, 9]);
    expect(t.every((x) => x.source === "written" && x.confidence === "none")).toBe(true);
  });
});

/** Weeks 11–12 as written, anchored on Feb 8, shifted evenly to `day`. */
function taperFor(day: string): TaperSession[] {
  const d = daysBetween("2027-02-08", day);
  const at = (iso: string) => addDays(iso, d);
  return [
    { dayId: "w11-mon", title: "Final Heavy Squat", date: at("2027-01-25"), heavy: ["squat"], light: ["bench"] },
    { dayId: "w11-tue", title: "Short Recovery Session", date: at("2027-01-26"), heavy: [], light: [] },
    { dayId: "w11-thu", title: "Final Heavy Bench", date: at("2027-01-28"), heavy: ["bench"], light: ["squat"] },
    { dayId: "w11-sat", title: "Final Heavy Deadlift", date: at("2027-01-30"), heavy: ["deadlift"], light: ["bench"] },
    { dayId: "w12-mon", title: "Taper: Squat, Bench, Deadlift", date: at("2027-02-01"), heavy: [], light: ["squat", "bench", "deadlift"] },
    { dayId: "w12-tue", title: "Optional Recovery", date: at("2027-02-02"), heavy: [], light: [] },
    { dayId: "w12-thu", title: "Taper: Technique Touch", date: at("2027-02-04"), heavy: [], light: ["squat", "bench"] },
    { dayId: "w12-sat", title: "Meet Primer", date: at("2027-02-06"), heavy: [], light: ["squat", "bench", "deadlift"], primer: true },
  ];
}

describe("planning the taper for a confirmed day", () => {
  const meets = pastMeetTapers(sets, ["2026-09-20"]);
  const notBefore = (day: string) => addDays("2027-01-23", daysBetween("2027-02-08", day)); // Week 10's Saturday

  for (const day of ["2027-02-08", "2027-02-10", "2027-02-13"]) {
    it(`${day}: every rule holds`, () => {
      const plan = planLiftTaper({ liftingDay: day, sessions: taperFor(day), meets, notBefore: notBefore(day), today: "2026-11-17", trainingDays: [1, 2, 4, 6] });
      const dates = plan.sessions.map((s) => s.planned);
      expect(new Set(dates).size).toBe(dates.length); // never two on one day
      expect(dates.every((d) => d > notBefore(day) && d < day)).toBe(true);
      const f = Object.fromEntries(plan.finalHeavy.map((x) => [x.lift, x.daysOut]));
      expect(Math.abs(f.squat - f.deadlift)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(f.squat - f.bench)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(f.bench - f.deadlift)).toBeGreaterThanOrEqual(2);
      for (const lift of ["squat", "bench", "deadlift"] as const) {
        expect(f[lift]).toBeGreaterThanOrEqual(TAPER_WINDOWS[lift].min);
        expect(f[lift]).toBeLessThanOrEqual(TAPER_WINDOWS[lift].max);
      }
      // the primer stays two days out
      expect(daysBetween(plan.sessions.find((s) => s.primer)!.planned, day)).toBe(2);
      // light work after a final heavy keeps 2+ days from it
      const heavyDay = Object.fromEntries(plan.finalHeavy.map((x) => [x.lift, x.date]));
      for (const s of plan.sessions.filter((x) => !x.heavy.length && x.light.length)) {
        for (const lift of s.light) expect(daysBetween(heavyDay[lift], s.planned)).toBeGreaterThanOrEqual(2);
      }
    });
  }

  it("with nothing to go on, the plan is the even shift", () => {
    const plan = planLiftTaper({ liftingDay: "2027-02-11", sessions: taperFor("2027-02-11"), meets: [], notBefore: notBefore("2027-02-11"), today: "2026-11-17" });
    expect(plan.moves).toEqual([]);
    expect(plan.finalHeavy.map((x) => x.daysOut)).toEqual([14, 11, 9]);
  });

  it("Jared's history moves squat closer than its 14-day placeholder, never bench or deadlift past their windows", () => {
    const plan = planLiftTaper({ liftingDay: "2027-02-08", sessions: taperFor("2027-02-08"), meets, notBefore: "2027-01-23", today: "2026-11-17", trainingDays: [1, 2, 4, 6] });
    const f = Object.fromEntries(plan.finalHeavy.map((x) => [x.lift, x.daysOut]));
    expect(f.squat).toBeLessThan(14);
    expect(plan.moves.length).toBeGreaterThan(0);
    for (const m of plan.moves) expect(m.why.length).toBeGreaterThan(0);
  });
});
