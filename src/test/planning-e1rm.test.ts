import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { meetsFromRows } from "@/lib/analytics/competition-strength";
import { e1rmSourceLine, planningE1rmByFamily, referenceLines } from "@/lib/workouts/planning-e1rm";
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
  meetsFromRows([{ meet_date: date, meet_name: name, squat_kg: 235, bench_kg: 150, deadlift_kg: deadliftKg }]);

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

  it("plans an off-season lifter's 60% from their training-day strength (Nov 25 2026: no weight at all)", () => {
    const out = planningE1rmByFamily(jared, meet("2026-09-18", 270), ["deadlift"], "2026-11-26");
    // the meet read as training-day capacity (a peak isn't every day), held through RPE 6 work
    expect(out.deadlift?.kg).toBeCloseTo(270 / 1.025, 0);
    expect(out.deadlift?.metric).toBe("current");
    expect(out.deadlift?.source).toEqual({ kind: "meet", day: "2026-09-18", name: "Commonwealth Championships" });
    expect(["moderate", "high"]).toContain(out.deadlift?.word);
    const r = computeRowLoad({
      exerciseName: "Paused Deadlift",
      basis: "est_1rm",
      percentage: 60,
      manualLoadKg: null,
      manualLoadLb: null,
      unit: "kg",
      maxesIndex: buildMaxIndex([]),
      family: "deadlift",
      ownCompetition: false,
      loggedE1rmKg: out.deadlift!.kg,
    });
    expect(r.load).toBe(157.5);
    expect(r.label).toBe("60% Comp Deadlift e1RM");
  });

  it("never reads a meet's attempts typed in days later at their rated RPE as more than the meet", () => {
    const withMeet = planningE1rmByFamily(jared, meet("2026-09-18", 270), ["deadlift"], "2026-11-26");
    expect(withMeet.deadlift!.kg).toBeLessThanOrEqual(270);
  });

  it("one set on its own never becomes the max a program reads (a unit slip)", () => {
    const one = deadlifts([{ day: "2026-11-20", kg: 495, reps: 4, rpe: 10 }]);
    expect(planningE1rmByFamily(one, [], ["deadlift"], "2026-11-26").deadlift).toBeUndefined();
  });

  it("only lighter sets is a lower bound: planned from (it can only run light), said to be at least", () => {
    const sets = deadlifts([
      { day: "2026-11-10", kg: 170, reps: 5, rpe: 6 },
      { day: "2026-11-17", kg: 175, reps: 5, rpe: 6 },
    ]);
    const out = planningE1rmByFamily(sets, [], ["deadlift"], "2026-11-26").deadlift!;
    expect(out.lowerBound).toBe(true);
    expect(out.kg).toBeGreaterThan(200);
    expect(referenceLines(out, "deadlift", "kg")[0]).toMatch(/at least this.*may run light/);
  });

  it("only the lifts asked for", () => {
    expect(planningE1rmByFamily(jared, meet("2026-09-18", 270), ["squat"], "2026-11-26")).toEqual({});
  });
});

describe("where it came from, behind the planned weight's ⓘ", () => {
  it("a meet, or the set behind it in the card's unit", () => {
    expect(e1rmSourceLine({ kind: "meet", day: "2026-09-18", name: "Commonwealth Championships" }, "deadlift", "kg")).toMatch(
      /^Your estimated max is your deadlift at Commonwealth Championships \(Sep 18(, 2026)?\)\.$/,
    );
    expect(e1rmSourceLine({ kind: "set", day: "2026-11-13", loadLb: 495, reps: 4, effort: 10 }, "deadlift", "kg")).toMatch(
      /^Your estimated max is worked out from 224\.5 kg × 4 @ RPE 10 on Nov 13(, 2026)?\.$/,
    );
    expect(e1rmSourceLine(null, "deadlift", "kg")).toBeNull();
  });

  it("says the metric, the source, the confidence and the last update", () => {
    const lines = referenceLines(
      {
        kg: 263.4,
        metric: "current",
        confidence: 0.62,
        word: "moderate",
        state: "held",
        source: { kind: "meet", day: "2026-09-18", name: "Commonwealth Championships" },
        lastUpdate: "2026-11-13",
        style: null,
        premium: 1.025,
      },
      "deadlift",
      "kg",
    );
    expect(lines[0]).toMatch(/current deadlift estimate is your lift at Commonwealth Championships .* training-day strength \(a peaked meet runs about 2\.5% over a training day\)/);
    expect(lines[1]).toMatch(/^Moderate confidence · last updated Nov 13/);
  });

  it("is said right after the working-out", () => {
    const v = plannedLoadView({
      percentage: 60,
      basis: "est_1rm",
      rpe: "5",
      unit: "kg",
      planned: 157.5,
      open: 157.5,
      reference: { lift: "Competition Deadlift", value: 263.4, unit: "kg" },
      label: "60% Comp Deadlift e1RM",
      referenceNote: ["Your current deadlift estimate is your lift at Commonwealth Championships (Sep 18).", "Moderate confidence."],
    });
    expect(v?.value).toBe("157.5 kg");
    expect(v?.why[0]).toMatch(/^60% of your Est\. 1RM \(Competition Deadlift 263\.4 kg\)/);
    expect(v?.why[1]).toMatch(/Commonwealth Championships/);
    expect(v?.why[2]).toBe("Moderate confidence.");
  });
});

describe("the logger and the coach's quick view read it", () => {
  const reads = readFileSync("src/lib/workouts/card-suggestion-reads.ts", "utf8");
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const guides = readFileSync("src/components/clients/workout-quick-view/load-guides.ts", "utf8");
  it("from the one strength read, never a narrower read of its own", () => {
    expect(reads).toContain("return fetchStrengthInputs(sb, clientId);");
    expect(reads).toContain("planningRefs(strengthIntelFrom(inputs, day))");
  });
  it("waits for it before the % says there's nothing on file, and reads a finished workout on its own day", () => {
    expect(wdv).toContain("const maxesPending = maxesLoading || (isStrengthBasis(row.percentage_basis) && e1rmPending);");
    expect(wdv).toContain('queryKey: ["logged-e1rm", "v3", historyOwnerId]');
    expect(wdv).toContain("strengthDayFor((completion as any)?.completed_at ?? null)");
    expect(guides).toContain('queryKey: ["logged-e1rm", "v3", clientId]');
    expect(guides).toContain("e1rmPending: e1rm.isLoading,");
  });
});
