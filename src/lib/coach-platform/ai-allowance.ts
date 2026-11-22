/**
 * AI for coach workspaces: what each feature costs, what a business gets each
 * month, and when to stop (pure, tested in coach-ai-allowance.test.ts). Not
 * live: nothing here is shown to a coach until the owner approves the numbers
 * (docs/COACH_PLATFORM_BUSINESS_2026-11.md, "AI allowance").
 *
 * Why credits per feature, not tokens: a coach can't predict tokens, and the
 * spread is huge (a check-in summary on GPT-5 mini is about US$0.004; one AI
 * program strategy on GPT-6 Astra measured US$1.20 to 2.50 in the Nov 9 2026
 * benchmark, docs/AI_ARCHITECTURE.md). A fixed price per feature is something
 * a coach can plan around; the platform is protected by a hard monthly spend
 * cap on what the calls really cost (org_ai_usage.cost_micro_usd), whatever
 * the credits said.
 *
 * Every number below is an assumption from list prices and the token sizes
 * the repo's own prompts and benchmarks show. Each call's real cost is kept
 * per business from the first one (org_ai_usage), and calibrate() turns
 * those rows into the price each feature should have.
 */
import { type SeatPricing, priceOfClient, paidClients } from "./seat-pricing";

/** US$ per million tokens (input, cached input, output), list prices seen Nov 2026. */
export const MODEL_PRICES_USD: Record<string, { input: number; cached: number; output: number; source: string }> = {
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2, source: "OpenAI price list (Aug 2025)" },
  "gpt-5.5": { input: 5, cached: 0.5, output: 30, source: "OpenAI price list as researched Nov 22 2026" },
  "gpt-6-astra": { input: 10, cached: 1, output: 50, source: "OpenAI rate card as reported (docs/AI_ARCHITECTURE.md)" },
  "claude-opus-5-5": { input: 4, cached: 0.4, output: 20, source: "Anthropic model docs" },
};

export const USD_TO_CAD = 1.43;

/** What one call cost, in millionths of a US dollar, or null for a model with no price on file. */
export function callCostMicroUsd(c: { model: string; input: number; cached?: number; output: number }): number | null {
  const key = c.model.replace(/^(openai|gateway|anthropic):/, "").replace(/^(openai|anthropic|google)\//, "");
  const p = MODEL_PRICES_USD[key];
  if (!p) return null;
  const cached = Math.min(Math.max(0, c.cached ?? 0), Math.max(0, c.input));
  const fresh = Math.max(0, c.input) - cached;
  // price per million tokens × tokens = micro-dollars
  return Math.round(fresh * p.input + cached * p.cached + Math.max(0, c.output) * p.output);
}

/** One credit is US$0.05 of model cost: small enough that a Cleo question is 1–2, big enough to read. */
export const CREDIT_MICRO_USD = 50_000;

export type CoachAiFeature =
  | "cleo_question"
  | "program_generate"
  | "program_edit"
  | "nutrition_plan"
  | "nutrition_change"
  | "file_import"
  | "checkin_summary"
  | "reply_draft"
  | "form_draft"
  | "exercise_identify";

type FeatureSpec = {
  label: string;
  /** Credits a coach is charged; 0 = included (fair use, still counted against the spend cap). */
  credits: number;
  /** The estimate behind it: model calls, each with input / cached / output tokens. */
  calls: Array<{ model: string; input: number; cached?: number; output: number }>;
};

/**
 * Each feature's price and the estimate it's set from (about the 75th
 * percentile: a typical run costs less than the credits, a long one more,
 * and the spend cap catches outliers).
 */
export const COACH_AI_FEATURES: Record<CoachAiFeature, FeatureSpec> = {
  cleo_question: {
    label: "Ask Cleo",
    credits: 2,
    // GPT-5.5 low, ~3 look-ups, an 18k prompt mostly read from cache
    calls: [{ model: "gpt-5.5", input: 30_000, cached: 25_000, output: 2_500 }],
  },
  program_generate: {
    label: "Generate a program",
    credits: 90,
    calls: [
      { model: "gpt-6-astra", input: 40_000, output: 22_000 }, // strategy (measured $1.20–2.50)
      { model: "gpt-5.5", input: 35_000, cached: 15_000, output: 12_000 }, // block 1
      { model: "gpt-5.5", input: 35_000, cached: 15_000, output: 12_000 }, // block 2
      { model: "gpt-5.5", input: 35_000, cached: 15_000, output: 12_000 }, // block 3
      { model: "gpt-6-astra", input: 45_000, output: 8_000 }, // coaching review
      { model: "gpt-5.5", input: 30_000, cached: 15_000, output: 8_000 }, // one repair
    ],
  },
  program_edit: {
    label: "Adjust a program",
    credits: 4,
    calls: [{ model: "gpt-5.5", input: 25_000, cached: 8_000, output: 4_000 }],
  },
  nutrition_plan: {
    label: "Draft a nutrition plan",
    credits: 22,
    calls: [
      { model: "gpt-6-astra", input: 18_000, output: 7_000 }, // targets
      { model: "gpt-5.5", input: 12_000, output: 9_000 }, // meal plan
      { model: "gpt-5.5", input: 14_000, cached: 8_000, output: 6_000 }, // one fix
    ],
  },
  nutrition_change: {
    label: "Adjust a nutrition plan",
    credits: 6,
    calls: [{ model: "gpt-5.5", input: 14_000, cached: 4_000, output: 7_000 }],
  },
  file_import: {
    label: "Read a program or meal plan file",
    credits: 8,
    calls: [{ model: "gpt-5.5", input: 30_000, output: 9_000 }],
  },
  checkin_summary: { label: "Check-in summary", credits: 0, calls: [{ model: "gpt-5-mini", input: 9_000, output: 1_200 }] },
  reply_draft: { label: "Reply draft", credits: 0, calls: [{ model: "gpt-5-mini", input: 6_000, output: 600 }] },
  form_draft: { label: "Draft a form", credits: 0, calls: [{ model: "gpt-5-mini", input: 3_000, output: 2_000 }] },
  exercise_identify: { label: "Find an exercise by description", credits: 0, calls: [{ model: "gpt-5-mini", input: 2_500, output: 200 }] },
};

/** What a feature's estimate costs (µUSD). */
export function featureEstimateMicroUsd(f: CoachAiFeature): number {
  return COACH_AI_FEATURES[f].calls.reduce((s, c) => s + (callCostMicroUsd(c) ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* The monthly allowance                                               */
/* ------------------------------------------------------------------ */

export type AllowancePolicy = {
  /** Credits every workspace gets, free tier included. */
  baseCredits: number;
  /** Share of each paid client's price that funds AI (what sets credits per client). */
  aiShareOfPrice: number;
  /** Hard cap on what calls may really cost in a month: this × the credits' value, plus a floor. */
  capMultiple: number;
  capFloorMicroUsd: number;
  /** Most of the month's cap one day can use (a runaway loop stops the same day). */
  dailyCapShare: number;
};

export const DEFAULT_ALLOWANCE: AllowancePolicy = {
  baseCredits: 20,
  aiShareOfPrice: 0.23,
  capMultiple: 1.5,
  capFloorMicroUsd: 3_000_000, // US$3
  dailyCapShare: 0.4,
};

/** The credit's value in CAD cents (what it costs JF Effect at the assumed exchange rate). */
export function creditCostCadCents(): number {
  return (CREDIT_MICRO_USD / 1_000_000) * 100 * USD_TO_CAD;
}

/** Credits a paid client brings: their own price × the AI share, so the $3 volume clients bring less. */
export function creditsForClient(priceCents: number, policy: AllowancePolicy = DEFAULT_ALLOWANCE): number {
  return Math.round((priceCents * policy.aiShareOfPrice) / creditCostCadCents());
}

/** A business's monthly credits: the base, plus each paid client's share. */
export function monthlyCredits(billableClients: number, pricing: SeatPricing, policy: AllowancePolicy = DEFAULT_ALLOWANCE): number {
  let total = policy.baseCredits;
  const paid = paidClients(billableClients, pricing);
  for (let k = pricing.freeClients + 1; k <= pricing.freeClients + paid; k += 1) total += creditsForClient(priceOfClient(k, pricing), policy);
  return total;
}

/** The month's hard spend cap (µUSD) for credits available (the allowance plus what they bought and still have). */
export function spendCapMicroUsd(creditsAvailable: number, policy: AllowancePolicy = DEFAULT_ALLOWANCE): number {
  return Math.round(Math.max(policy.capFloorMicroUsd, creditsAvailable * CREDIT_MICRO_USD * policy.capMultiple));
}

/* ------------------------------------------------------------------ */
/* Using it                                                            */
/* ------------------------------------------------------------------ */

export type AllowanceState = {
  allowance: number;
  /** Credits used from the allowance this month. */
  used: number;
  /** Bought or given credits still left (never expire). */
  purchasedLeft: number;
  /** What calls really cost this month and today (µUSD). */
  spentMicroUsd: number;
  spentTodayMicroUsd: number;
};

export type Decision =
  | { ok: true; credits: number; from: "allowance" | "purchased" | "included"; warn: boolean }
  | { ok: false; reason: "out_of_credits" | "monthly_cap" | "daily_cap"; words: string };

/**
 * May this feature run now, and whose credits pay for it? Credits first (what
 * the coach sees), then the platform's caps: the month's (what this call
 * would bring the real spend to) and the day's (already spent today, so one
 * big run always fits a fresh day).
 */
export function decide(feature: CoachAiFeature, s: AllowanceState, policy: AllowancePolicy = DEFAULT_ALLOWANCE): Decision {
  const credits = COACH_AI_FEATURES[feature].credits;
  const left = Math.max(0, s.allowance - s.used);
  let pay: Decision;
  if (credits === 0) pay = { ok: true, credits: 0, from: "included", warn: false };
  else if (left >= credits) pay = { ok: true, credits, from: "allowance", warn: left - credits < s.allowance * 0.2 };
  else if (s.purchasedLeft >= credits) pay = { ok: true, credits, from: "purchased", warn: s.purchasedLeft - credits < 20 };
  else {
    return { ok: false, reason: "out_of_credits", words: `${COACH_AI_FEATURES[feature].label} uses ${credits} credits and you have ${left + s.purchasedLeft} left this month.` };
  }
  const cap = spendCapMicroUsd(s.allowance + s.purchasedLeft, policy);
  if (s.spentMicroUsd + featureEstimateMicroUsd(feature) > cap) {
    return { ok: false, reason: "monthly_cap", words: "AI is paused for this workspace until next month: it's used what this month allows. Your clients aren't affected." };
  }
  if (s.spentTodayMicroUsd >= cap * policy.dailyCapShare) {
    return { ok: false, reason: "daily_cap", words: "That's a lot of AI for one day. It's back tomorrow." };
  }
  return pay;
}

/* ------------------------------------------------------------------ */
/* Packs (web only, never in the native apps)                          */
/* ------------------------------------------------------------------ */

export type CoachCreditPack = { credits: number; priceCents: number };
/** Proposed, not approved: priced at about 1.75× cost so card fees and tax leave a margin. */
export const COACH_CREDIT_PACKS: CoachCreditPack[] = [
  { credits: 200, priceCents: 2500 },
  { credits: 600, priceCents: 6900 },
];

/** A pack's margin after card fees (2.9% + 30¢) and the AI it buys at full use. */
export function packMargin(p: CoachCreditPack): { costCents: number; feesCents: number; marginCents: number; marginPercent: number } {
  const costCents = Math.round(p.credits * creditCostCadCents());
  const feesCents = Math.round(p.priceCents * 0.029 + 30);
  const marginCents = p.priceCents - costCents - feesCents;
  return { costCents, feesCents, marginCents, marginPercent: Math.round((marginCents / p.priceCents) * 1000) / 10 };
}

/* ------------------------------------------------------------------ */
/* What it costs JF Effect (the owner's view)                          */
/* ------------------------------------------------------------------ */

/** AI's worst case (every credit used) and a typical month, against the seat revenue. */
export function allowanceEconomics(billableClients: number, pricing: SeatPricing, utilization = 0.5, policy: AllowancePolicy = DEFAULT_ALLOWANCE) {
  const credits = monthlyCredits(billableClients, pricing, policy);
  const worstCadCents = Math.round(credits * creditCostCadCents());
  const typicalCadCents = Math.round(worstCadCents * utilization);
  let revenue = 0;
  for (let k = pricing.freeClients + 1; k <= billableClients; k += 1) revenue += priceOfClient(k, pricing);
  return {
    credits,
    worstCadCents,
    typicalCadCents,
    revenueCadCents: revenue,
    worstShareOfRevenue: revenue ? Math.round((worstCadCents / revenue) * 1000) / 10 : null,
  };
}

/* ------------------------------------------------------------------ */
/* Calibration from real calls                                         */
/* ------------------------------------------------------------------ */

export type UsageRow = { feature: string; cost_micro_usd: number; refused?: boolean };

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo));
};

/**
 * From real calls: each feature's median, 75th and 90th percentile cost, and
 * the credits the 75th percentile says it should have (at least 5 calls, or
 * it keeps its estimate and says so).
 */
export function calibrate(rows: readonly UsageRow[]) {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    if (r.refused || !Number.isFinite(r.cost_micro_usd)) continue;
    by.set(r.feature, [...(by.get(r.feature) ?? []), r.cost_micro_usd]);
  }
  return (Object.keys(COACH_AI_FEATURES) as CoachAiFeature[]).map((f) => {
    const xs = by.get(f) ?? [];
    const p75 = quantile(xs, 0.75);
    const current = COACH_AI_FEATURES[f].credits;
    const suggested = xs.length >= 5 ? (current === 0 && p75 < CREDIT_MICRO_USD / 5 ? 0 : Math.max(1, Math.ceil(p75 / CREDIT_MICRO_USD))) : current;
    return {
      feature: f,
      calls: xs.length,
      medianMicroUsd: quantile(xs, 0.5),
      p75MicroUsd: p75,
      p90MicroUsd: quantile(xs, 0.9),
      estimateMicroUsd: featureEstimateMicroUsd(f),
      currentCredits: current,
      suggestedCredits: suggested,
      basis: xs.length >= 5 ? "measured" : "estimate (fewer than 5 calls)",
    };
  });
}
