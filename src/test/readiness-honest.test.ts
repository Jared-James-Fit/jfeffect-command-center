import { describe, expect, it } from "vitest";
import { pickRecommendation, readinessAge, READINESS_STALE_DAYS } from "@/lib/analytics/readiness-factors";

const f = (score: number, isMissing = false) => ({ score, isMissing }) as any;

describe("readiness says only what was logged", () => {
  it("missing sleep or energy is never read as short sleep or poor recovery", () => {
    const factors = { pain: f(100), sleep: f(0, true), load: f(80), recovery: f(0, true), consistency: f(90), performance: f(85) };
    expect(pickRecommendation(factors, null)).toMatch(/^Nothing stands out in what you logged/);
    expect(pickRecommendation({ ...factors, sleep: f(20) }, null)).toMatch(/^Sleep was short/);
  });

  it("says how old the score is, and drops one from weeks ago", () => {
    const now = new Date("2026-11-14T12:00:00");
    expect(readinessAge("2026-11-13T19:00:00", now)).toMatchObject({ days: 1, stale: false, fromLabel: null });
    expect(readinessAge("2026-11-12T19:00:00", now)).toMatchObject({ days: 2, fromLabel: "Thursday" });
    expect(readinessAge("2026-11-06T19:00:00", now)).toMatchObject({ days: 8, fromLabel: "Nov 6" });
    expect(readinessAge("2026-10-20T19:00:00", now)!.stale).toBe(true);
    expect(READINESS_STALE_DAYS).toBe(14);
    expect(readinessAge(null, now)).toBeNull();
  });
});
