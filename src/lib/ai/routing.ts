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

export type AiTask = "strategy" | "review" | "construct" | "repair" | "interpret" | "edit" | "nutrition" | "nutrition_write" | "roadmap" | "meal_estimate" | "form_draft" | "coach_write" | "assistant" | "exercise_identify" | "post_write" | "program_import" | "nutrition_roadmap" | "nutrition_import" | "pain_describe" | "recovery_write";
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
  /**
   * A coach's "Draft with AI" form (form-draft.ts): a list of questions from what they asked for,
   * read by code (parseFormDraft) and saved as a draft only the coach sees until they send it.
   */
  /**
   * Exercise search's "describe it" (exercise-identify): a lifter describes an exercise instead of
   * naming it and the model names what it most likely is (a few short names and how sure it is),
   * which the app then finds in its own library. One short answer someone is waiting on
   * (callModelNow) at GPT-5's minimal effort (6-10 s at low in production on Nov 20 2026, too
   * slow for a search box); only ever a suggestion, never chosen for them.
   */
  exercise_identify: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "minimal", maxOutputTokens: 600, strongOnly: false },
  form_draft: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "low", maxOutputTokens: 8_000, strongOnly: false },
  /**
   * Crew's automated posts as decks (post-decks.server.ts, Nov 20 2026): a lesson or tip turned into
   * slides and a caption the crew reads in the feed, then an editor's read of it. Public writing in
   * the coach's name, checked in code (post-deck-checks.ts) and by the editor before it's published;
   * written ahead in the background, so the stronger writer is worth its seconds. OpenAI key only.
   */
  post_write: { models: ["openai:gpt-5.5", "openai:gpt-5-mini"], effort: "medium", maxOutputTokens: 12_000, strongOnly: false },
  /**
   * Coach-side writing a person reads before anything reaches a client (Nov 18 2026): the weekly
   * check-in recap and its suggested reply, AI drafts of a form reply, a lead's first text, the
   * inbox Brief, My Voice's "Try it". Summaries of numbers code already worked out (never a new
   * coaching decision), answered inside the request (askRoute, route-call.server.ts). They ran on
   * Lovable credits through one model with no fallback (Gemini Flash); GPT-5 mini is as quick,
   * GPT-5.5 backs it up.
   */
  coach_write: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "low", maxOutputTokens: 6_000, strongOnly: false },
  /**
   * Cleo, the admin assistant (summer.server.ts, Nov 18 2026): one conversation with live look-ups and
   * the cards the person confirms, answered while they wait (chat and voice). It ran on Lovable credits
   * (GPT-5.5 through the gateway's chat completions, which drop the model's reasoning between tool
   * steps, then Gemini Flash); on the OpenAI key it uses the Responses API, which keeps the reasoning
   * across look-ups (cleo-model.server.ts). Effort from the Nov 18 live benchmark (cleo-bench hook).
   */
  assistant: { models: ["openai:gpt-5.5", "openai:gpt-5-mini"], effort: "low", strongOnly: false },
  /**
   * Reading a program someone already has (a PDF, photos, a layout the parser can't read on its
   * own) into the app's structure (program-import, Nov 21 2026): copying, never deciding, and
   * checked by code against the file before the person reviews it (groundingFlags). Accuracy
   * over speed, in the background: GPT-5.5 reads PDFs and page photos directly, Astra backs it up;
   * never GPT-5 mini, which drops rows on a long program. A member's or client's own AI use,
   * metered with AI credits (program_import).
   */
  program_import: { models: ["openai:gpt-5.5", "openai:gpt-6-astra"], effort: "medium", maxOutputTokens: 100_000, strongOnly: false },
  /**
   * Reading a meal plan someone already has (a PDF, photos, a spreadsheet or document the app's own
   * reader can't take) into the app's meal-plan text (nutrition-import, Nov 22 2026): copying, never
   * deciding, the same as program_import. Checked by code against the file before the person sees it
   * (planGroundingFlags: a number or a food word the file doesn't have is flagged). GPT-5.5 reads PDFs
   * and photos directly, Astra backs it up; never GPT-5 mini. In the background (staged calls); a
   * member's or client's own AI use, metered with AI credits (nutrition_import), never a staff
   * member's. Create with Cleo's drafts are writing to targets and go through nutrition_write.
   */
  nutrition_import: { models: ["openai:gpt-5.5", "openai:gpt-6-astra"], effort: "medium", maxOutputTokens: 40_000, strongOnly: false },
  /**
   * A nutrition roadmap revision's two lines of words (nutrition-roadmap/explain.server.ts, Nov 22
   * 2026): the engine decides every number, the model only words it, and code throws the answer
   * away when it adds a number or mentions something the app never plans. Short, once per
   * revision; the engine's own words stand in when no model answers. OpenAI key only.
   */
  nutrition_roadmap: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "low", maxOutputTokens: 2_000, strongOnly: false },
  /**
   * "Describe it" in a pain report (pain/describe.server.ts, Nov 22 2026): only when the app's own
   * reader (describe.ts) found nothing it could place. The model copies places, sides, numbers and
   * exercises out of what the athlete said, never adds any; code keeps only region and spot keys
   * that exist and a number or exercise that's in their words. One short answer someone is waiting
   * on, at minimal effort. Never metered (reporting pain never costs a credit); rate-limited.
   */
  pain_describe: { models: ["openai:gpt-5-mini", "openai:gpt-5.5"], effort: "minimal", maxOutputTokens: 1_500, strongOnly: false },
  /**
   * Recovery automation's replies and follow-ups (recovery-automation/run.server.ts, Nov 22 2026):
   * a message the coach approves, or a routine one sent under his name by his own rule, so the
   * stronger writer first; checked in code before anything goes (draftProblems, autoMessageProblems).
   * In the background, never a client waiting. OpenAI key only.
   */
  recovery_write: { models: ["openai:gpt-5.5", "openai:gpt-5-mini"], effort: "low", maxOutputTokens: 6_000, strongOnly: false },
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
