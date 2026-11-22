import { describe, expect, it } from "vitest";
import {
  COACH_AI_FEATURES,
  COACH_CREDIT_PACKS,
  CREDIT_MICRO_USD,
  DEFAULT_ALLOWANCE,
  type AllowanceState,
  type CoachAiFeature,
  allowanceEconomics,
  calibrate,
  callCostMicroUsd,
  creditsForClient,
  decide,
  featureEstimateMicroUsd,
  monthlyCredits,
  packMargin,
  spendCapMicroUsd,
} from "@/lib/coach-platform/ai-allowance";
import { PROPOSED_PRICING, RECOMMENDED_PRICING } from "@/lib/coach-platform/seat-pricing";

const features = Object.keys(COACH_AI_FEATURES) as CoachAiFeature[];

describe("what a call costs", () => {
  it("prices fresh input, cached input and output separately", () => {
    // GPT-5.5: $5 in, $0.50 cached, $30 out per million
    expect(callCostMicroUsd({ model: "gpt-5.5", input: 1_000_000, output: 0 })).toBe(5_000_000);
    expect(callCostMicroUsd({ model: "openai:gpt-5.5", input: 1_000_000, cached: 1_000_000, output: 0 })).toBe(500_000);
    expect(callCostMicroUsd({ model: "gpt-5.5", input: 0, output: 1_000_000 })).toBe(30_000_000);
    expect(callCostMicroUsd({ model: "gpt-5-mini", input: 9_000, output: 1_200 })).toBe(4_650);
  });

  it("never guesses a price it doesn't have", () => {
    expect(callCostMicroUsd({ model: "some-new-model", input: 1000, output: 1000 })).toBeNull();
  });

  it("the program strategy estimate sits inside the benchmark's measured US$1.20–2.50", () => {
    const strategy = COACH_AI_FEATURES.program_generate.calls[0];
    const c = callCostMicroUsd(strategy)!;
    expect(c).toBeGreaterThanOrEqual(1_200_000);
    expect(c).toBeLessThanOrEqual(2_500_000);
  });
});

describe("feature prices", () => {
  it("every charged feature's credits cover at least 85% of its estimate (the spend cap catches the rest)", () => {
    for (const f of features) {
      const { credits } = COACH_AI_FEATURES[f];
      if (!credits) continue;
      expect(credits * CREDIT_MICRO_USD, f).toBeGreaterThanOrEqual(featureEstimateMicroUsd(f) * 0.85);
      expect(credits * CREDIT_MICRO_USD, f).toBeLessThanOrEqual(featureEstimateMicroUsd(f) * 1.5);
    }
  });

  it("only features under a cent are included", () => {
    for (const f of features) {
      if (COACH_AI_FEATURES[f].credits === 0) expect(featureEstimateMicroUsd(f), f).toBeLessThan(10_000);
    }
  });
});

describe("the monthly allowance", () => {
  it("each paid client brings credits from their own price ($5 → 16, a $3 volume client → 10)", () => {
    expect(creditsForClient(500)).toBe(16);
    expect(creditsForClient(300)).toBe(10);
  });

  it("free tier: the base only; then the base plus each paid client's share", () => {
    expect(monthlyCredits(0, RECOMMENDED_PRICING)).toBe(DEFAULT_ALLOWANCE.baseCredits);
    expect(monthlyCredits(1, RECOMMENDED_PRICING)).toBe(20);
    expect(monthlyCredits(2, RECOMMENDED_PRICING)).toBe(36);
    expect(monthlyCredits(25, RECOMMENDED_PRICING)).toBe(20 + 24 * 16);
    expect(monthlyCredits(26, RECOMMENDED_PRICING)).toBe(20 + 24 * 16 + 10);
    // the flat proposal never drops to the volume price
    expect(monthlyCredits(26, PROPOSED_PRICING)).toBe(20 + 25 * 16);
  });

  it("at every size worth paying for, the worst case (every credit used) stays near a quarter of seat revenue", () => {
    for (const n of [10, 25, 26, 50, 100, 250]) {
      const e = allowanceEconomics(n, RECOMMENDED_PRICING);
      expect(e.worstShareOfRevenue!, String(n)).toBeLessThanOrEqual(27);
    }
    // a 2-client coach's base dominates: the honest number, said in the business doc
    expect(allowanceEconomics(2, RECOMMENDED_PRICING).worstShareOfRevenue).toBeGreaterThan(40);
  });

  it("the hard cap is 1.5× what the credits are worth, never under US$3", () => {
    expect(spendCapMicroUsd(0)).toBe(3_000_000);
    expect(spendCapMicroUsd(1000)).toBe(1000 * CREDIT_MICRO_USD * 1.5);
  });
});

describe("deciding a call", () => {
  const s = (over: Partial<AllowanceState> = {}): AllowanceState => ({
    allowance: 100, used: 0, purchasedLeft: 0, spentMicroUsd: 0, spentTodayMicroUsd: 0, ...over,
  });

  it("charges the allowance first, then bought credits", () => {
    expect(decide("program_edit", s())).toMatchObject({ ok: true, credits: 4, from: "allowance" });
    expect(decide("program_edit", s({ used: 98, purchasedLeft: 50 }))).toMatchObject({ ok: true, from: "purchased" });
  });

  it("says plainly when there aren't enough", () => {
    const d = decide("program_generate", s({ used: 60, purchasedLeft: 10 }));
    expect(d).toMatchObject({ ok: false, reason: "out_of_credits" });
    expect((d as any).words).toBe("Generate a program uses 90 credits and you have 50 left this month.");
  });

  it("included features don't use credits but still count against the cap", () => {
    expect(decide("checkin_summary", s({ used: 100 }))).toMatchObject({ ok: true, credits: 0, from: "included" });
    const capped = decide("checkin_summary", s({ spentMicroUsd: spendCapMicroUsd(100) }));
    expect(capped).toMatchObject({ ok: false, reason: "monthly_cap" });
  });

  it("a runaway day stops the same day", () => {
    const cap = spendCapMicroUsd(100);
    expect(decide("program_edit", s({ spentMicroUsd: cap * 0.41, spentTodayMicroUsd: cap * 0.41 }))).toMatchObject({ ok: false, reason: "daily_cap" });
  });

  it("warns when the allowance runs low", () => {
    expect(decide("program_edit", s({ used: 80 }))).toMatchObject({ ok: true, warn: true });
    expect(decide("program_edit", s({ used: 10 }))).toMatchObject({ ok: true, warn: false });
  });
});

describe("packs (proposed)", () => {
  it("keep a margin even if every credit is used, after card fees", () => {
    for (const p of COACH_CREDIT_PACKS) expect(packMargin(p).marginPercent).toBeGreaterThanOrEqual(30);
  });
});

describe("calibration from real calls", () => {
  it("prices a feature from its 75th percentile once it has 5 calls", () => {
    const rows = [100_000, 150_000, 200_000, 260_000, 300_000, 900_000].map((c) => ({ feature: "program_edit", cost_micro_usd: c }));
    const r = calibrate(rows).find((x) => x.feature === "program_edit")!;
    expect(r.basis).toBe("measured");
    expect(r.p75MicroUsd).toBe(290_000);
    expect(r.suggestedCredits).toBe(6);
  });

  it("keeps the estimate with fewer calls, and ignores refused ones", () => {
    const r = calibrate([{ feature: "nutrition_plan", cost_micro_usd: 5_000_000 }, { feature: "nutrition_plan", cost_micro_usd: 1, refused: true }]).find((x) => x.feature === "nutrition_plan")!;
    expect(r).toMatchObject({ calls: 1, suggestedCredits: COACH_AI_FEATURES.nutrition_plan.credits, basis: "estimate (fewer than 5 calls)" });
  });

  it("an included feature stays included while it's under a fifth of a credit", () => {
    const rows = Array.from({ length: 10 }, () => ({ feature: "checkin_summary", cost_micro_usd: 5_000 }));
    expect(calibrate(rows).find((x) => x.feature === "checkin_summary")!.suggestedCredits).toBe(0);
  });
});
