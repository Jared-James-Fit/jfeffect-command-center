import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bestLoggedMaxes,
  compLiftFromName,
  implausibleCoachMaxes,
  LIFT_FOCUS,
  pickCurrentMaxes,
  sbdSplit,
  sessionsPerWeek,
  TYPICAL_SHARE,
} from "@/lib/analytics/sbd-split";

describe("SBD split", () => {
  it("splits the total and calls out the strongest lift and the biggest opportunity", () => {
    // 545 / 315 / 640: bench is light for a man, deadlift heavy.
    const s = sbdSplit({ squat: 545, bench: 315, deadlift: 640 }, "male");
    expect(s.total).toBe(1500);
    const share = Object.fromEntries(s.lifts.map((l) => [l.lift, Math.round(l.share * 1000) / 10]));
    expect(share).toEqual({ squat: 36.3, bench: 21, deadlift: 42.7 });
    expect(s.strongest).toBe("deadlift");
    expect(s.focus).toBe("bench");
    expect(s.lifts.find((l) => l.lift === "bench")!.status).toBe("below");
    // Bench to a typical 24% with S+D fixed: 0.24 × 1185 / 0.76 = 374.2 → +59.2 lb.
    expect(s.gainToTypical).toBeCloseTo(59.2, 1);
  });

  it("the same numbers are typical for a woman — norms matter", () => {
    const s = sbdSplit({ squat: 545, bench: 315, deadlift: 640 }, "female");
    expect(s.lifts.every((l) => l.status === "within")).toBe(true);
    expect(s.gainToTypical).toBeNull();
  });

  it("typical ranges are centered on the team's own meet averages", () => {
    const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
    expect(mid(TYPICAL_SHARE.male.bench)).toBeCloseTo(0.24, 2);
    expect(mid(TYPICAL_SHARE.female.deadlift)).toBeCloseTo(0.435, 2);
    for (const sex of ["male", "female"] as const) {
      const sum =
        mid(TYPICAL_SHARE[sex].squat) +
        mid(TYPICAL_SHARE[sex].bench) +
        mid(TYPICAL_SHARE[sex].deadlift);
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThan(1.01);
    }
  });

  it("best logged e1RM per lift skips sets over 10 reps", () => {
    const m = bestLoggedMaxes([
      { lift: "squat", load: 405, reps: 5, date: "2026-09-01" },
      { lift: "squat", load: 315, reps: 15, date: "2026-09-02" },
      { lift: "bench", load: 300, reps: 1, date: "2026-09-03" },
    ]);
    expect(m.squat).toMatchObject({ lb: 472.5, source: "logged", set: { load: 405, reps: 5 } });
    expect(m.bench!.lb).toBe(300);
    expect(m.deadlift).toBeUndefined();
  });

  it("current max is the higher of logged and coach; a meet only fills gaps", () => {
    const out = pickCurrentMaxes(
      { squat: { lift: "squat", lb: 470, source: "logged", date: "2026-09-20" } },
      {
        squat: { lift: "squat", lb: 500, source: "coach", date: "2026-06-01" },
        bench: { lift: "bench", lb: 300, source: "coach", date: null },
      },
      {
        squat: { lift: "squat", lb: 480, source: "meet", date: "2026-03-01" },
        bench: { lift: "bench", lb: 310, source: "meet", date: "2026-03-01" },
        deadlift: { lift: "deadlift", lb: 600, source: "meet", date: "2026-03-01" },
      },
    );
    expect(out.squat!.source).toBe("coach");
    expect(out.bench!.lb).toBe(300);
    expect(out.deadlift!.source).toBe("meet");
  });

  it("ignores a coach max saved in kg that was meant as lb (the 315 kg bench case)", () => {
    const logged = {
      squat: { lift: "squat" as const, lb: 545.6, source: "logged" as const, date: "2026-07-26" },
      bench: { lift: "bench" as const, lb: 356, source: "logged" as const, date: "2026-09-01" },
      deadlift: { lift: "deadlift" as const, lb: 615, source: "logged" as const, date: "2026-09-01" },
    };
    // 315 and 600 typed as lb, stored as kg → ×2.2046.
    const coach = {
      bench: { lift: "bench" as const, lb: 315 * 2.2046226, source: "coach" as const, date: "2026-06-09" },
      deadlift: { lift: "deadlift" as const, lb: 600 * 2.2046226, source: "coach" as const, date: "2026-06-09" },
    };
    const bad = implausibleCoachMaxes(logged, coach);
    expect(bad.map((b) => b.lift)).toEqual(["bench", "deadlift"]);
    expect(bad.every((b) => b.likelyKgLbMixup)).toBe(true);
    const out = pickCurrentMaxes(logged, coach, {});
    expect(out.bench).toMatchObject({ source: "logged", lb: 356 });
    expect(out.deadlift).toMatchObject({ source: "logged", lb: 615 });
    const total = out.squat!.lb + out.bench!.lb + out.deadlift!.lb;
    expect(Math.round(total)).toBe(1517); // not 2,563
  });

  it("still trusts a real tested max above submax e1RMs", () => {
    const logged = { squat: { lift: "squat" as const, lb: 470, source: "logged" as const, date: "2026-09-20" } };
    const coach = { squat: { lift: "squat" as const, lb: 540, source: "coach" as const, date: "2026-09-25" } };
    expect(implausibleCoachMaxes(logged, coach)).toEqual([]);
    expect(pickCurrentMaxes(logged, coach, {}).squat!.source).toBe("coach");
  });

  it("maps comp lift names, never variations", () => {
    expect(compLiftFromName("Competition Squat")).toBe("squat");
    expect(compLiftFromName("Competition Bench Press")).toBe("bench");
    expect(compLiftFromName("Sumo Deadlift")).toBe("deadlift");
    expect(compLiftFromName("Pause Squat")).toBeNull();
    expect(compLiftFromName("Romanian Deadlift")).toBeNull();
    expect(compLiftFromName("Close Grip Bench Press")).toBeNull();
  });

  it("counts training days per week for frequency notes", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const sets = [
      "2026-09-05",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
      "2026-10-06",
      "2026-10-06",
    ].map((d) => ({
      lift: "bench" as const,
      date: `${d}T18:00:00Z`,
    }));
    expect(sessionsPerWeek(sets, "bench", now)).toBe(1);
  });

  it("focuses stay inside the plan: free habits add no sets, volume changes go to the coach", () => {
    for (const f of Object.values(LIFT_FOCUS)) {
      expect(f.free).toHaveLength(3);
      for (const t of f.free) expect(t).not.toMatch(/\badd (a|an|extra) (set|day|session)/i);
      expect(f.askCoach).toMatch(/coach/i);
    }
  });
});

describe("SBD card wiring", () => {
  const card = readFileSync("src/components/analytics/sbd-split-card.tsx", "utf8");
  const dash = readFileSync("src/components/analytics/client-analytics-dashboard.tsx", "utf8");

  it("reads comp lifts through the shared load normalizer and outlier guard", () => {
    expect(card).toContain("resultLoadLb(r)");
    expect(card).toContain("neutralizeObviousLoadOutliers(rows)");
    expect(card).toContain('.eq("is_competition_lift", true)');
  });

  it("sits right after the summary, ahead of lift progress", () => {
    expect(card).toContain('<section aria-label="SBD Total">');
    const sbd = dash.indexOf("<SbdSplitCard");
    expect(sbd).toBeGreaterThan(dash.indexOf('aria-label="Summary"'));
    expect(sbd).toBeLessThan(dash.indexOf('aria-label="Lift Progress"'));
  });
});
