/**
 * The Nutrition Update Request's own pieces that screens need (its form id,
 * how answers are read and summed up, the workout-meal options, the coach's
 * update length). Safe for the browser: the AI prompts themselves live in
 * nutrition-ai-prompts.server.ts and never ship to a phone.
 */

export const NUTRITION_REQUEST_FORM_ID = "b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d";
export const NUTRITION_REQUEST_FORM_TYPE = "nutrition_update";

export type QA = { label: string; value: string };

/** "Q: label / A: value" block the AI reads, skipping blanks. */
export function formatAnswers(qas: QA[]): string {
  return qas
    .filter((q) => q.value.trim())
    .map((q) => `${q.label}: ${q.value.trim()}`)
    .join("\n");
}

/** Find an answer by keywords in its question label (case-insensitive). */
export function answerFor(qas: QA[], ...keywords: string[]): string {
  const hit = qas.find((q) => keywords.every((k) => q.label.toLowerCase().includes(k.toLowerCase())));
  return hit?.value.trim() ?? "";
}

/** What the profile already knows about the client (never asked twice). */
export type ClientBasics = {
  name: string;
  /** "Male" / "Female"; omitted when unknown or "prefer not to say". */
  sex?: string | null;
  age?: number | null;
  /** Display height, e.g. "5 ft 10 in". */
  height?: string | null;
};

function basicsOf(client: string | ClientBasics): ClientBasics {
  return typeof client === "string" ? { name: client } : client;
}

/**
 * Name / sex / age / height lines from the profile. Sex and height are left
 * out when the form already answered them, so nothing appears twice.
 */
export function clientBasicsLines(client: string | ClientBasics, qas: QA[] = []): string[] {
  const c = basicsOf(client);
  const answered = (re: RegExp) => qas.some((q) => re.test(q.label.trim()) && q.value.trim());
  return [
    `Client name: ${c.name}`,
    c.sex && !answered(/^sex\b/i) ? `Sex: ${c.sex}` : "",
    c.age != null ? `Age: ${c.age}` : "",
    c.height && !answered(/^height\b/i) ? `Height: ${c.height}` : "",
  ].filter(Boolean);
}

/**
 * The whole submission as one paste-ready block: who the client is, the
 * coach's phase, then every answer. For building a plan by hand.
 */
export function nutritionSubmissionSummary(opts: {
  client: string | ClientBasics;
  qas: QA[];
  phase?: string | null;
  submittedAt?: string | null;
}): string {
  const c = basicsOf(opts.client);
  const when = opts.submittedAt
    ? new Date(opts.submittedAt).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return [
    `NUTRITION FORM — ${c.name}`,
    when ? `Submitted: ${when}` : "",
    ...clientBasicsLines(c, opts.qas).slice(1),
    opts.phase ? `Coach phase: ${opts.phase}` : "",
    "",
    formatAnswers(opts.qas),
  ]
    .filter((l, i, all) => l !== "" || i === all.length - 2)
    .join("\n");
}

/** Coach override for pre/post-workout meals (stored on the request). */
export type WorkoutMealsMode = "auto" | "pre_post" | "post_only" | "pre_only" | "none";

export const WORKOUT_MEALS_OPTIONS: { value: WorkoutMealsMode; label: string }[] = [
  { value: "auto", label: "Auto — from the client's training time" },
  { value: "pre_post", label: "Pre + Post-Workout meals" },
  { value: "post_only", label: "Post-Workout only (trains fasted)" },
  { value: "pre_only", label: "Pre-Workout only" },
  { value: "none", label: "No workout meals" },
];

/** Longest set of instructions the coach can send in one update. */
export const REVISE_MAX_CHARS = 2000;

