import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildReadinessBreakdown } from "@/lib/analytics/readiness-factors";

const read = (p: string) => readFileSync(p, "utf8");

describe("Workouts page: one card per section, nothing said twice", () => {
  const readiness = read("src/components/analytics/recovery-preview-card.tsx");
  const month = read("src/components/training-analytics-preview-card.tsx");

  it("readiness is one compact row that opens the whole picture: score, today's call, limiter, six factor bars", () => {
    // In the page: one row (the score, the call's first line + limiter, a chevron)…
    expect(readiness).toContain('data-testid="readiness-row"');
    expect(readiness).toContain('onClick={() => setView("overview")}');
    // …and nothing it used to show is lost: it's all in the sheet the row opens.
    expect(readiness).toContain('<SheetContent side="bottom"');
    expect(readiness).toContain('data-testid="readiness-call"');
    expect(readiness).toContain("<FactorBar key={k}");
    expect(readiness).toContain("Limiter: {bd.limiter.label}");
    expect(readiness).toContain("<FactorSheet factor={activeFactor} />");
    // Back from a factor steps out to the whole picture, not off the sheet.
    expect(readiness).toContain('setView((v) => (v && v !== "overview" ? "overview" : null))');
    // No regex lookbehind: older iPhones can't parse it (the whole chunk would fail).
    expect(readiness).not.toContain("(?<=");
    // Gone: duplicate caption, block avg / trend tiles, biggest-positive pill, six big rings, fake insights.
    for (const gone of ["Estimated Training Readiness", "Current Block Avg", "Biggest Positive", "What's Affecting Today's Readiness", "Personalized Insights", "FactorRing"]) {
      expect(readiness, gone).not.toContain(gone);
    }
  });

  it("the month card is one row of three numbers; weight lifted and the athlete rows fold under More", () => {
    expect(month).toContain('<Tile label="Workouts"');
    expect(month).toContain('<Tile label="PRs"');
    expect(month).toContain('<Tile label="Week streak"');
    // the analytics page reads by block, so the month's own numbers stay one tap away here
    expect(month).toContain("<CollapsibleContent");
    expect(month).toContain('data-testid="month-weight-line"');
    expect(month).toContain('label="Strongest lift"');
    expect(month).toContain('label="Most trained this week"');
    expect(month).toContain('to="/portal/workouts/analytics"');
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
