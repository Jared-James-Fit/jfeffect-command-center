import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReadinessBreakdown } from "@/lib/analytics/readiness-factors";

const read = (p: string) => readFileSync(p, "utf8");

describe("Workouts page: one card per section, nothing said twice", () => {
  const readiness = read("src/components/analytics/recovery-preview-card.tsx");
  const month = read("src/components/training-analytics-preview-card.tsx");

  it("readiness is one card: score, today's call, limiter, six factor bars", () => {
    expect(readiness).toContain('data-testid="readiness-call"');
    expect(readiness).toContain("<FactorBar key={k}");
    // Gone: duplicate caption, block avg / trend tiles, biggest-positive pill, six big rings, fake insights.
    for (const gone of ["Estimated Training Readiness", "Current Block Avg", "Biggest Positive", "What's Affecting Today's Readiness", "Personalized Insights", "FactorRing"]) {
      expect(readiness, gone).not.toContain(gone);
    }
  });

  it("the month card is flat: one number, one comparison line, three tiles, two athlete rows", () => {
    expect(month).toContain('data-testid="month-weight-line"');
    for (const gone of ["weightComparison", "school bus", "backdrop-blur", "Athlete corner"]) {
      expect(month, gone).not.toContain(gone);
    }
  });

  it("uses line icons, not emoji: they render differently on every phone", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{FE0F}]/u;
    for (const [name, src] of [
      ["readiness card", readiness],
      ["month card", month],
      ["readiness factors", read("src/lib/analytics/readiness-factors.ts")],
    ] as const) {
      expect(src, name).not.toMatch(emoji);
    }
    expect(readiness).toContain("FACTOR_ICON[factor.key]");
  });

  it("the insights that weren't true are gone from the library too", () => {
    expect(read("src/lib/analytics/readiness-factors.ts")).not.toContain("buildPersonalInsights");
  });
});

describe("consistency says where its score comes from", () => {
  const base = {
    sleepSamples: [],
    recoverySamples: [],
    load: { current7: { sets: 0, tonnage: 0, avgRpe: null, days: 0 }, priorWeeks: [] },
    scores: [],
    painDays7d: 0,
  } as any;
  const consistency = {
    weekDueSoFar: 0, weekCompleted: 0, weekTotalScheduled: 3, weekRemaining: 3, weekMissed: 0,
    last4: { scheduled: 14, completed: 13 }, block: null, streak: 5, trend: "Stable", cardio: null,
  };

  it("nothing due yet this week → shows the last-4-weeks number it actually scores from", () => {
    const f = buildReadinessBreakdown({ ...base, consistency }).factors.consistency;
    expect(f.score).toBe(93);
    expect(f.currentValue).toBe("93% last 4 weeks");
  });

  it("with workouts due, it reports this week", () => {
    const f = buildReadinessBreakdown({ ...base, consistency: { ...consistency, weekDueSoFar: 2, weekCompleted: 2, weekRemaining: 1 } }).factors.consistency;
    expect(f.currentValue).toBe("100% · On Track");
  });
});
