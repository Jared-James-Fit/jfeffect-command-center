import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comparableE1rm, effortOf, strengthTrend, trendWords, STEADY_PCT } from "@/lib/analytics/strength-read";
import { groupLiftSessions } from "@/lib/analytics/lift-sessions";
import { estimate1RMWithRpe } from "@/lib/analytics/e1rm";

const read = (p: string) => readFileSync(p, "utf8");

describe("a set shows a max only when it was hard enough to", () => {
  it("hard sets of 10 reps or fewer, read with their effort (Program Intelligence's formula)", () => {
    expect(comparableE1rm({ load: 200, reps: 3, rpe: 9 })).toBe(estimate1RMWithRpe(200, 3, 9));
    expect(comparableE1rm({ load: 200, reps: 1, rpe: 10 })).toBe(200);
    // RIR counts the same way: 2 RIR = RPE 8
    expect(comparableE1rm({ load: 150, reps: 5, rir: 2 })).toBe(estimate1RMWithRpe(150, 5, 8));
  });
  it("light, unrated or long sets say nothing about a max", () => {
    expect(comparableE1rm({ load: 120, reps: 5, rpe: 6 })).toBeNull();
    expect(comparableE1rm({ load: 120, reps: 5 })).toBeNull();
    expect(comparableE1rm({ load: 60, reps: 15, rpe: 9 })).toBeNull();
    expect(comparableE1rm({ load: 0, reps: 5, rpe: 9 })).toBeNull();
    expect(effortOf({ rpe: "8.5" })).toBe(8.5);
    expect(effortOf({ rir: 3 })).toBe(7);
  });
  it("a light day no longer reads as strength lost: the session's strength is its hard sets only", () => {
    const [heavy, light] = groupLiftSessions([
      { id: "a", date: "2026-11-02T18:00:00Z", load: 200, reps: 3, est_1rm: 220, rpe: 9 },
      { id: "b", date: "2026-11-05T18:00:00Z", load: 140, reps: 5, est_1rm: 163.3, rpe: 6 },
    ]);
    expect(heavy.strength).toBeCloseTo(estimate1RMWithRpe(200, 3, 9), 5);
    expect(light.strength).toBeNull();
    // the raw every-set reading is still there for the fallback
    expect(light.e1rm).toBe(163.3);
  });
});

describe("the strength trend: the best sessions, never one session or a noisy line", () => {
  const pts = (vals: number[], start = "2026-10-01") =>
    vals.map((value, i) => ({ date: new Date(Date.parse(start) + i * 7 * 86_400_000).toISOString(), value }));
  it("up, down or steady from the best of the first and last few", () => {
    const up = strengthTrend(pts([200, 205, 190, 210, 215, 212]));
    expect(up.kind).toBe("up");
    if (up.kind !== "unclear") expect(up.pct).toBeCloseTo(((215 - 205) / 205) * 100, 1);
    expect(strengthTrend(pts([210, 205, 200, 196, 194, 190])).kind).toBe("down");
    expect(strengthTrend(pts([200, 199, 202, 201, 200, 201])).kind).toBe("steady");
  });
  it("one bad day in the middle doesn't move it", () => {
    expect(strengthTrend(pts([200, 202, 150, 201, 203, 202])).kind).toBe("steady");
  });
  it("too few sessions or too short a span: too early, never a guess", () => {
    expect(strengthTrend(pts([200, 210, 220]))).toMatchObject({ kind: "unclear", reason: "few" });
    const short = [0, 3, 6, 9].map((d, i) => ({ date: new Date(Date.parse("2026-11-01") + d * 86_400_000).toISOString(), value: 200 + i * 5 }));
    expect(strengthTrend(short)).toMatchObject({ kind: "unclear", reason: "short" });
    expect(trendWords(strengthTrend(pts([200])))).toBe("Too early");
    expect(STEADY_PCT).toBe(2);
  });
});

describe("the screens read strength the same way", () => {
  it("the lift card plots comparable sets, says when it can't, and never calls an estimate a lift", () => {
    const card = read("src/components/analytics/lift-progress-card.tsx");
    expect(card).toContain("comparable ? s.strength");
    expect(card).toContain("strengthTrend(");
    expect(card).toContain("Estimated from every set, so read it as a floor.");
    expect(card).toContain('{ key: "est", label: "Est. max" }');
    expect(card).toContain("Heaviest");
    expect(card).not.toContain("e1rmTrendPerWeek");
  });
  it("the insights read the comparable max and the shared trend", () => {
    const pi = read("src/lib/analytics/performance-insights.ts");
    expect(pi).toContain("comparableE1rm({ load: s.load_lb, reps: s.reps, rpe: s.rpe })");
    expect(pi).toContain("strengthTrend(s.e1rm_trend");
  });
});

describe("history reads like a coach's log", () => {
  it("a day is one line of shorthand and opens to its sets; the date leads", () => {
    const sheet = read("src/components/exercise-history-sheet.tsx");
    expect(sheet).toContain("data-history-day-summary");
    expect(sheet).toContain("{openDays.has(dayKey) && (");
    expect(sheet).toContain('format(d, "EEE, MMM d, yyyy")');
  });
  it("the suggestion's ⓘ is two lines with the working-out folded", () => {
    const card = read("src/components/workout-day/load-suggestion-card.tsx");
    expect(card).toContain('data-testid="load-why"');
    expect(card).toContain("How it's worked out");
    expect(card).not.toContain("Just a suggestion");
  });
});
