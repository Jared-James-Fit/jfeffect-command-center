/**
 * Which model answers which coaching task, and how hard it thinks.
 *
 * Coaching decisions (the strategy, the coaching review of a built program,
 * reading an athlete's training) go to the strongest reasoning model, and only
 * ever fall back to another model of the same tier: a weaker model never
 * quietly makes a coaching decision; if none answers, the run stops and says so.
 * Turning an approved strategy into workouts is structured writing checked by
 * the deterministic audit, so it may fall back further (and the fallback is
 * named on the job). Simple edits that code can do never reach a model.
 *
 * Model names: see model-client.server.ts ("openai:…" direct, "gateway:…" via
 * the Lovable gateway). Chosen from live checks and a benchmark on real
 * athletes (docs/AI_ARCHITECTURE.md). Pure.
 */
import type { Effort } from "./model-client.server";

export type AiTask = "strategy" | "review" | "construct" | "repair" | "interpret" | "edit";
export type Route = {
  /** Tried in order. */
  models: string[];
  effort: Effort;
  maxOutputTokens?: number;
  /** Coaching decisions: every model listed is a top-tier reasoning model; nothing weaker is added. */
  strongOnly: boolean;
};

/** The top tier: models allowed to make a coaching decision. */
export const STRONG_MODELS = ["openai:gpt-6-astra", "gateway:openai/gpt-6-astra", "gateway:anthropic/claude-opus-5-5", "openai:gpt-5.5", "gateway:openai/gpt-5.5"];

/**
 * Chosen from the Nov 9 2026 benchmark on real athletes (docs/AI_ARCHITECTURE.md): the strategy,
 * blind-graded, was best from GPT-6 Astra (47/60 average, all 5 head-to-heads against GPT-5.5's
 * 43; Flash 24), which runs in OpenAI's background mode with no time ceiling; GPT-5.5 through
 * the gateway is the fallback (it can 524 on a think over ~125s). Claude through the gateway
 * couldn't finish a strategy inside one request (no background mode there), so it isn't routed.
 * Building from an approved strategy: Flash and GPT-5.5 had the same audit results on every
 * paired build, Flash 2-5x faster, so Flash builds and GPT-5.5 is its fallback.
 */
export const DEFAULT_ROUTES: Record<AiTask, Route> = {
  strategy: { models: ["openai:gpt-6-astra", "gateway:openai/gpt-5.5"], effort: "high", maxOutputTokens: 40_000, strongOnly: true },
  review: { models: ["openai:gpt-6-astra", "gateway:openai/gpt-5.5"], effort: "medium", maxOutputTokens: 24_000, strongOnly: true },
  interpret: { models: ["openai:gpt-6-astra", "gateway:openai/gpt-5.5"], effort: "medium", maxOutputTokens: 24_000, strongOnly: true },
  construct: { models: ["gateway:google/gemini-3-flash-preview", "gateway:openai/gpt-5.5"], effort: "low", maxOutputTokens: 48_000, strongOnly: false },
  repair: { models: ["gateway:google/gemini-3-flash-preview", "gateway:openai/gpt-5.5"], effort: "low", maxOutputTokens: 48_000, strongOnly: false },
  edit: { models: ["gateway:openai/gpt-5.5", "gateway:google/gemini-3-flash-preview"], effort: "medium", strongOnly: false },
};

/**
 * A route with an override (an admin setting, or a benchmark run's models). A coaching task stays
 * strong-only unless it's a benchmark comparing models on purpose (`anyModel`).
 */
export function resolveRoute(task: AiTask, override?: Partial<Record<AiTask, string[]>> | null, opts: { anyModel?: boolean } = {}): Route {
  const base = DEFAULT_ROUTES[task];
  const asked = override?.[task]?.filter((m) => typeof m === "string" && /^(openai|gateway):[\w./-]+$/.test(m)) ?? [];
  const models = base.strongOnly && !opts.anyModel ? asked.filter((m) => STRONG_MODELS.includes(m)) : asked;
  return models.length ? { ...base, models } : base;
}
