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

export type AiTask = "strategy" | "review" | "construct" | "repair" | "interpret" | "edit" | "nutrition" | "nutrition_write" | "roadmap" | "meal_estimate";
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
 * Every default runs on the OpenAI key (`openai:`, background mode), never the Lovable gateway:
 * the coach doesn't want Lovable credits spent, and direct calls also never hit the gateway's
 * ~125s 524 or hold a request open (Nov 9 2026). An admin override (app_settings.ai_routes) can
 * still name a `gateway:` model.
 *
 * Chosen from the Nov 9 2026 benchmark on real athletes (docs/AI_ARCHITECTURE.md): the strategy,
 * blind-graded, was best from GPT-6 Astra (47/60 average, all 5 head-to-heads against GPT-5.5's
 * 43; Flash 24); GPT-5.5 is its fallback. Claude through the gateway couldn't finish a strategy
 * inside one request (no background mode there), so it isn't routed. Building from an approved
 * strategy: Flash and GPT-5.5 had the same audit results on every paired build (Flash 2-5x
 * faster); Flash only exists through the gateway, so GPT-5.5 builds (slower, in the background,
 * the same quality) and Astra is its fallback. Edits, meal plans and roadmap words fall back to
 * GPT-5-mini, which is checked by code before anything is used (engine.ts, prepDrift,
 * planTotalsIssues, parseRoadmapReply).
 */
export const DEFAULT_ROUTES: Record<AiTask, Route> = {
  strategy: { models: ["openai:gpt-6-astra", "openai:gpt-5.5"], effort: "high", maxOutputTokens: 40_000, strongOnly: true },
  review: { models: ["openai:gpt-6-astra", "openai:gpt-5.5"], effort: "medium", maxOutputTokens: 24_000, strongOnly: true },
  interpret: { models: ["openai:gpt-6-astra", "openai:gpt-5.5"], effort: "medium", maxOutputTokens: 24_000, strongOnly: true },
  construct: { models: ["openai:gpt-5.5", "openai:gpt-6-astra"], effort: "low", maxOutputTokens: 48_000, strongOnly: false },
  repair: { models: ["openai:gpt-5.5", "openai:gpt-6-astra"], effort: "low", maxOutputTokens: 48_000, strongOnly: false },
  edit: { models: ["openai:gpt-5.5", "openai:gpt-5-mini"], effort: "medium", strongOnly: false },
  /**
   * A Nutrition Update's targets: calories, macros, steps and cardio from the athlete's records
   * and how the last plan went. A coaching decision, so the strong tier only, like the strategy.
   */
  nutrition: { models: ["openai:gpt-6-astra", "openai:gpt-5.5"], effort: "medium", maxOutputTokens: 24_000, strongOnly: true },
  /**
   * Writing a meal plan to those targets, its meal-prep fix and coach updates: structured writing
   * checked in code (prepDrift, planTotalsIssues), like construct.
   */
  nutrition_write: { models: ["openai:gpt-5.5", "openai:gpt-5-mini"], effort: "low", maxOutputTokens: 24_000, strongOnly: false },
  /** The roadmap's words (block purpose, weekly focus): short writing, re-run on every program change. */
  roadmap: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "low", maxOutputTokens: 8_000, strongOnly: false },
  /**
   * A member's or client's AI food log ("2 eggs, toast and butter" → its macros): one short answer
   * they're waiting on, metered with AI credits (src/lib/ai-credits). Answered inside the request
   * (callModelNow), and read by code before it's shown (parseMealEstimate).
   */
  meal_estimate: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "low", maxOutputTokens: 2_000, strongOnly: false },
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
