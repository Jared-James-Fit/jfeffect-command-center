import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { meetsFromRows } from "@/lib/analytics/competition-strength";
import { E1RM_PLAN_DAYS, e1rmSourceLine, planningE1rmByFamily } from "@/lib/workouts/planning-e1rm";
import { buildMaxIndex, computeRowLoad } from "@/lib/pl-maxes";
import { plannedLoadView } from "@/lib/workouts/planned-load";

const LB = 2.2046226218;
type Set = { day: string; kg?: number; lb?: number; reps: number; rpe?: number | null };

/** analytics' result shape (getClientResults): load in lb, the competition deadlift */
const deadlifts = (sets: Set[]) =>
  sets.map((s) => ({
    date: `${s.day}T12:00:00Z`,
    load: s.lb ?? (s.kg as number) * LB,
    counts_load: true,
    reps: s.reps,
    rpe: s.rpe ?? null,
    rir: null,
    est_1rm: 0,
    competition_lift_type: "deadlift",
    is_competition_lift: true,
  }));

const meet = (date: string, deadliftKg: number, name = "Commonwealth Championships") =>
  meetsFromRows([
    { meet_date: date, meet_name: name, squat_kg: 235, bench_kg: 150, deadlift_kg: deadliftKg },
  ]);

describe("the estimated max a % of Est. 1RM reads", () => {
  // Jared's off-season, Nov 2026: a 270 kg meet pull on Sep 18 (its attempts typed in
  // on Sep 22 at "RPE 8"), RPE 6 pulls since, one hard set (495 lb × 4 @ 10) on Nov 13.
  const jared = deadlifts([
    { day: "2026-09-13", lb: 545, reps: 1, rpe: 8.5 },
    { day: "2026-09-22", kg: 270, reps: 1, rpe: 8 },
    { day: "2026-09-22", kg: 247.5, reps: 1, rpe: 8 },
    { day: "2026-10-10", kg: 170, reps: 5, rpe: 6 },
    { day: "2026-10-17", kg: 175, reps: 5, rpe: 6 },
    { day: "2026-11-07", lb: 495, reps: 3, rpe: 5 },
    { day: "2026-11-13", lb: 495, reps: 4, rpe: 10 },
    { day: "2026-11-13", lb: 365, reps: 4, rpe: 6 },
    { day: "2026-11-21", kg: 240, reps: 1, rpe: 6 },
    { day: "2026-11-21", kg: 185, reps: 4, rpe: 6 },
  ]);

  it("plans an off-season lifter's 60% from the line the Strength tab shows (Nov 25 2026: no weight at all)", () => {
    const out = planningE1rmByFamily(jared, meet("2026-09-18", 270), ["deadlift"], "2026-11-26");
    expect(out.deadlift?.kg).toBe(270);
    expect(out.deadlift?.state).toBe("held"); // one hard session under the meet is a fluctuation
    expect(out.deadlift?.source).toEqual({
      kind: "meet",
      day: "2026-09-18",
      name: "Commonwealth Championships",
    });
    // 60% → 162 kg, rounded to the plates
    const idx = buildMaxIndex([]);
    const r = computeRowLoad({
      exerciseName: "Paused Deadlift",
      basis: "est_1rm",
      percentage: 60,
      manualLoadKg: null,
      manualLoadLb: null,
      unit: "kg",
      maxesIndex: idx,
      family: "deadlift",
      ownCompetition: false,
      loggedE1rmKg: out.deadlift!.kg,
    });
    expect(r.load).toBe(162.5);
  });

  it("never reads a meet's attempts typed in days later at their rated RPE as more than the meet", () => {
    const withMeet = planningE1rmByFamily(
      jared,
      meet("2026-09-18", 270),
      ["deadlift"],
      "2026-11-26",
    );
    const without = planningE1rmByFamily(jared, [], ["deadlift"], "2026-11-26");
    expect(withMeet.deadlift!.kg).toBeLessThan(without.deadlift!.kg); // 270 @ "8" reads ~297 kg on its own
  });

  it("a lighter set that implies more raises it, and says which set", () => {
    const sets = deadlifts([
      { day: "2026-10-01", kg: 200, reps: 3, rpe: 8 },
      { day: "2026-10-08", kg: 200, reps: 3, rpe: 8 },
      { day: "2026-11-20", kg: 220, reps: 4, rpe: 6 }, // credited at most RPE 8: a lower bound over the line
    ]);
    expect(planningE1rmByFamily(sets, [], ["deadlift"], "2026-11-20").deadlift?.state).toBe(
      "raised",
    );
    const out = planningE1rmByFamily(sets, [], ["deadlift"], "2026-11-26");
    expect(out.deadlift?.kg).toBeCloseTo(264, 0); // 220 × 4 credited at RPE 8, held since
    expect(out.deadlift?.source).toMatchObject({
      kind: "set",
      day: "2026-11-20",
      reps: 4,
      effort: 6,
    });
    // its own day counts as evidence, however old the last hard set is
    const late = deadlifts([
      { day: "2026-06-01", kg: 200, reps: 3, rpe: 8 },
      { day: "2026-06-08", kg: 200, reps: 3, rpe: 8 },
      { day: "2026-11-20", kg: 220, reps: 4, rpe: 6 },
    ]);
    expect(
      planningE1rmByFamily(late, [], ["deadlift"], "2026-11-26").deadlift?.source,
    ).toMatchObject({ day: "2026-11-20" });
  });

  it("only lighter sets ever is a lower bound, not a max: the RPE leads", () => {
    const sets = deadlifts([
      { day: "2026-11-10", kg: 170, reps: 5, rpe: 6 },
      { day: "2026-11-17", kg: 175, reps: 5, rpe: 6 },
    ]);
    expect(planningE1rmByFamily(sets, [], ["deadlift"], "2026-11-26").deadlift).toBeUndefined();
  });

  it("one set on its own never becomes the max a program reads (a unit slip)", () => {
    const one = deadlifts([{ day: "2026-11-20", kg: 495, reps: 4, rpe: 10 }]);
    expect(planningE1rmByFamily(one, [], ["deadlift"], "2026-11-26").deadlift).toBeUndefined();
  });

  it(`not past ${E1RM_PLAN_DAYS} days since the last hard set or meet`, () => {
    const old = deadlifts([
      { day: "2026-06-01", kg: 230, reps: 3, rpe: 8 },
      { day: "2026-06-08", kg: 232.5, reps: 3, rpe: 8 },
      { day: "2026-11-20", kg: 150, reps: 5, rpe: 5 },
    ]);
    expect(planningE1rmByFamily(old, [], ["deadlift"], "2026-11-26").deadlift).toBeUndefined();
    // 16 weeks of RPE-capped work after a meet still plans from the meet
    const offSeason = deadlifts([
      { day: "2026-08-20", kg: 170, reps: 5, rpe: 6 },
      { day: "2026-11-20", kg: 170, reps: 5, rpe: 6 },
    ]);
    expect(
      planningE1rmByFamily(offSeason, meet("2026-08-10", 260), ["deadlift"], "2026-11-26").deadlift
        ?.kg,
    ).toBe(260);
  });

  it("only the lifts asked for", () => {
    const out = planningE1rmByFamily(jared, meet("2026-09-18", 270), ["squat"], "2026-11-26");
    expect(out).toEqual({});
  });
});

describe("where it came from, behind the planned weight's ⓘ", () => {
  it("a meet, or the set behind it in the card's unit", () => {
    expect(
      e1rmSourceLine(
        { kind: "meet", day: "2026-09-18", name: "Commonwealth Championships" },
        "deadlift",
        "kg",
      ),
    ).toMatch(
      /^Your estimated max is your deadlift at Commonwealth Championships \(Sep 18(, 2026)?\)\.$/,
    );
    expect(
      e1rmSourceLine(
        { kind: "set", day: "2026-11-13", loadLb: 495, reps: 4, effort: 10 },
        "deadlift",
        "kg",
      ),
    ).toMatch(
      /^Your estimated max is worked out from 224\.5 kg × 4 @ RPE 10 on Nov 13(, 2026)?\.$/,
    );
    expect(
      e1rmSourceLine(
        { kind: "set", day: "2026-11-13", loadLb: 495, reps: 4, effort: null },
        "deadlift",
        "lb",
      ),
    ).toMatch(/from 495 lb × 4 on Nov 13/);
    expect(e1rmSourceLine(null, "deadlift", "kg")).toBeNull();
  });

  it("is said right after the working-out", () => {
    const v = plannedLoadView({
      percentage: 60,
      basis: "est_1rm",
      rpe: "5",
      unit: "kg",
      planned: 162.5,
      open: 162.5,
      reference: { lift: "Competition Deadlift", value: 270, unit: "kg" },
      label: "60% Comp Deadlift e1RM",
      referenceNote: "Your estimated max is your deadlift at Commonwealth Championships (Sep 18).",
    });
    expect(v?.value).toBe("162.5 kg");
    expect(v?.why[0]).toBe(
      "60% of your Est. 1RM (Competition Deadlift 270 kg) is 162 kg, rounded to 162.5 kg.",
    );
    expect(v?.why[1]).toMatch(/Commonwealth Championships/);
  });
});

describe("the logger and the coach's quick view read it", () => {
  const reads = readFileSync("src/lib/workouts/card-suggestion-reads.ts", "utf8");
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const guides = readFileSync("src/components/clients/workout-quick-view/load-guides.ts", "utf8");
  it("from their sets and meets, with errors thrown, never a narrower read of its own", () => {
    expect(reads).toContain("planningE1rmByFamily(results, meetsFromRows(");
    expect(reads).toContain("if (meetRes.error) throw meetRes.error;");
    expect(reads).not.toContain("loggedE1rm(");
  });
  it("waits for it before the % says there's nothing on file", () => {
    expect(wdv).toContain(
      'const maxesPending = maxesLoading || (row.percentage_basis === "est_1rm" && e1rmPending);',
    );
    expect(wdv).toContain('queryKey: ["logged-e1rm", "v2", historyOwnerId');
    expect(guides).toContain('queryKey: ["logged-e1rm", "v2", clientId');
    expect(guides).toContain("e1rmPending: e1rm.isLoading,");
  });
});
