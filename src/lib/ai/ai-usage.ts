/**
 * What an AI call costs and how usage is read (Nov 23 2026). Pure.
 *
 * Prices are US$ per million tokens from OpenAI's and Anthropic's published rate cards, only
 * where there's a source; anything else is logged with its tokens and no price, never a guess.
 * Sources (checked Nov 23 2026):
 *   - GPT-5.5: $5.00 in / $0.50 cached in / $30.00 out (OpenAI pricing, April 2026 launch,
 *     as reported by The Register and apidog; OpenAI's model page developers.openai.com/api/docs/models/gpt-5.5)
 *   - GPT-5.1 and GPT-5: $1.25 / $0.125 / $10.00 (OpenAI model pages)
 *   - GPT-5 mini: $0.25 / $0.025 / $2.00 (OpenAI price list, Aug 2025)
 *   - GPT-6 Astra: $10 / $50 (OpenAI rate card as reported; no cached rate on file)
 *   - Claude Opus 5.5 $4 / $20, Sonnet 5 $2 / $10 (Anthropic's model table; gateway calls bill
 *     in Lovable credits, so these are only an estimate of what they're worth)
 *   - gpt-image-1: $5 text in / $40 image out (OpenAI image pricing)
 */
export type Price = { input: number; cachedInput?: number; output: number };

export const AI_PRICES: Record<string, Price> = {
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "gpt-image-1": { input: 5, output: 40 },
};

/** "openai:gpt-5.5" / "gateway:openai/gpt-5.5" / "gpt-5.5-2026-04-23" → "gpt-5.5". */
export function priceKeyOf(model: string): string {
  const bare = model
    .replace(/^(openai|gateway|lovable):/, "")
    .replace(/^(openai|anthropic|google)\//, "");
  if (AI_PRICES[bare]) return bare;
  // a dated snapshot ("gpt-5-mini-2025-08-07") is priced like its model
  const undated = bare.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return undated;
}

/**
 * Estimated US$ for one call, or null when the model has no price on file. Cached input is
 * charged at its cached rate where one is published; reasoning tokens are already counted in
 * OpenAI's output tokens, so they're never added twice.
 */
export function callCost(
  model: string,
  usage: { input?: number | null; cached?: number | null; output?: number | null },
): number | null {
  const p = AI_PRICES[priceKeyOf(model)];
  if (!p || usage.input == null || usage.output == null) return null;
  const cached = Math.max(0, Math.min(usage.cached ?? 0, usage.input));
  const fresh = usage.input - cached;
  const cost =
    (fresh * p.input + cached * (p.cachedInput ?? p.input) + usage.output * p.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * The feature a call belongs to, as the coach would name it, for the usage table. `task` is the
 * routing key (routing.ts) or a direct caller's own key; `feature` a finer label some callers add
 * ("recovery_write:workout_reply"). Unknown keys show as they are.
 */
const FEATURE_NAMES: Record<string, string> = {
  coach_write: "Coach writing (form drafts, lead texts, Brief, My Voice)",
  checkin_recap: "Check-in recaps",
  recovery_write: "Coaching queue replies",
  "recovery_write:pain": "Coaching queue · pain replies and follow-ups",
  "recovery_write:workout": "Coaching queue · workout replies",
  "recovery_write:checkin": "Coaching queue · check-in replies",
  "recovery_write:missed": "Coaching queue · missed sessions",
  "recovery_write:video": "Coaching queue · set videos",
  "recovery_write:progress": "Coaching queue · progress check-ins",
  "coach_write:pain": "Pain report · reply draft (on request)",
  assistant: "Cleo",
  strategy: "Generate a program · strategy",
  construct: "Generate a program · build",
  repair: "Generate a program · repair",
  review: "Generate a program · coaching review",
  interpret: "Program Intelligence · interpretation",
  edit: "Adjust program",
  nutrition: "Nutrition plan · targets",
  nutrition_write: "Nutrition plan · meals",
  nutrition_roadmap: "Nutrition roadmap words",
  nutrition_import: "Meal plan import",
  roadmap: "Training roadmap words",
  meal_estimate: "Food log estimates (credits)",
  form_draft: "Form drafts",
  exercise_identify: "Exercise search · describe it",
  post_write: "Crew post decks",
  program_import: "Program import",
  pain_describe: "Pain report · describe it",
  pain_transcribe: "Pain report · voice",
  daily_visual: "Athlete Insights",
  post_picture: "Crew post pictures",
  lesson_art: "Lesson covers",
  probe: "AI health check",
};

export function featureName(key: string): string {
  return FEATURE_NAMES[key] ?? FEATURE_NAMES[key.split(":")[0]] ?? key;
}

/**
 * Today's spend against the usual day: "unusual" when today's estimated cost is over three times
 * the median of the 14 days before it and at least `floorUsd` (a few cents more on a quiet day is
 * never an alert), or today's calls are over three times the usual and at least `floorCalls`.
 */
export function unusualUsage(
  today: { cost: number; calls: number },
  history: { cost: number; calls: number }[],
  floorUsd = 3,
  floorCalls = 300,
): { unusual: boolean; usualCost: number; usualCalls: number; why: string | null } {
  const usualCost = median(history.map((d) => d.cost));
  const usualCalls = median(history.map((d) => d.calls));
  const costSpike = today.cost >= floorUsd && today.cost > 3 * Math.max(usualCost, 0.5);
  const callSpike = today.calls >= floorCalls && today.calls > 3 * Math.max(usualCalls, 20);
  const why = costSpike
    ? `about $${today.cost.toFixed(2)} so far today against a usual $${usualCost.toFixed(2)} a day`
    : callSpike
      ? `${today.calls} calls so far today against a usual ${Math.round(usualCalls)}`
      : null;
  return {
    unusual: costSpike || callSpike,
    usualCost: round(usualCost),
    usualCalls: Math.round(usualCalls),
    why,
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
