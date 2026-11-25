/**
 * What Cleo Autopilot costs (Nov 25 2026): the calls it makes and an estimate
 * at 25 / 50 / 100 / 250 / 500 clients (docs/CLEO_AUTOPILOT.md prints this
 * table). The assessment itself is code and costs nothing; a model is asked
 * only to write the check-in reply (the recap's own call, which existed
 * before) and a draft that can't be worked out in code (a nutrition change's
 * new menus, a training change, a cardio change the engine's treadmill step
 * can't express), and when the coach taps Re-create. Prices come from
 * AI_PRICES (ai-usage.ts, sourced); the per-call token sizes and how often
 * each happens are estimates, said as such. Pure and tested (autopilot.test.ts).
 */
import { callCost } from "@/lib/ai/ai-usage";

export type CallProfile = {
  key: string;
  label: string;
  model: string;
  /** Average tokens per call (estimate). */
  input: number;
  output: number;
  /** Calls per client per week (estimate). */
  perClientWeek: number;
};

/** Estimates: token sizes from the prompts' typical length; frequencies from how often each change is proposed. */
export const CALL_PROFILES: CallProfile[] = [
  { key: "reply", label: "Check-in reply (written with the recap: one call)", model: "gpt-5-mini", input: 6_000, output: 900, perClientWeek: 1 },
  { key: "nutrition", label: "Nutrition draft (Change it with AI: targets + menus)", model: "gpt-5.5", input: 18_000, output: 5_000, perClientWeek: 0.35 * 2 },
  { key: "training", label: "Training draft (Edit with AI proposal)", model: "gpt-5.5", input: 22_000, output: 4_000, perClientWeek: 0.15 },
  { key: "cardio", label: "Cardio draft the treadmill step can't express (Cleo — Cardio)", model: "gpt-5.5", input: 9_000, output: 2_000, perClientWeek: 0.05 },
  { key: "recreate", label: "Re-create (the coach asks for new wording)", model: "gpt-5-mini", input: 4_000, output: 400, perClientWeek: 0.3 },
];

export const CLIENT_SCALES = [25, 50, 100, 250, 500] as const;

export type CostRow = { clients: number; callsPerWeek: number; tokensPerWeek: number; usdPerWeek: number; usdPerMonth: number };

/** Weekly and monthly (4.33 weeks) estimate for a number of clients. */
export function estimateCost(clients: number, profiles: CallProfile[] = CALL_PROFILES): CostRow {
  let calls = 0;
  let tokens = 0;
  let usd = 0;
  for (const p of profiles) {
    const n = p.perClientWeek * clients;
    calls += n;
    tokens += n * (p.input + p.output);
    usd += n * (callCost(p.model, { input: p.input, output: p.output }) ?? 0);
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { clients, callsPerWeek: Math.round(calls), tokensPerWeek: Math.round(tokens), usdPerWeek: r2(usd), usdPerMonth: r2(usd * 4.33) };
}

export function costTable(): CostRow[] {
  return CLIENT_SCALES.map((n) => estimateCost(n));
}

/** A decision's recorded usage, added up. */
export type Usage = { calls: number; input_tokens: number; output_tokens: number; usd?: number };
export function addUsage(a: Usage | null | undefined, b: { model?: string | null; input?: number | null; output?: number | null }): Usage {
  const base: Usage = { calls: a?.calls ?? 0, input_tokens: a?.input_tokens ?? 0, output_tokens: a?.output_tokens ?? 0, usd: a?.usd ?? 0 };
  const usd = b.model ? callCost(b.model, { input: b.input ?? 0, output: b.output ?? 0 }) ?? 0 : 0;
  return {
    calls: base.calls + 1,
    input_tokens: base.input_tokens + (b.input ?? 0),
    output_tokens: base.output_tokens + (b.output ?? 0),
    usd: Math.round(((base.usd ?? 0) + usd) * 1_000_000) / 1_000_000,
  };
}
