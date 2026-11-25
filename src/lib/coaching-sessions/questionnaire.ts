/**
 * The pre-call questions (pure, tested in coaching-sessions.test.ts): one form
 * in the native forms engine ("Before our call", seeded by
 * 20270528110000_pre_call_questions.sql), each question tagged with a
 * `validation.session_key`. A send asks only the keys a session is missing
 * (the assignment's `settings.ask_keys`), so it takes one to three minutes;
 * the weigh-in starts from their own log (prefill), and nothing the app
 * already knows is asked again.
 */

export const PRE_CALL_FORM_ID = "c0a1e7e0-5a7e-4c0d-9f00-000000000e01";
export const PRE_CALL_FORM_TYPE = "pre_call";

export type SessionKey =
  | "topics"
  | "training_feel"
  | "recovery"
  | "pain"
  | "pain_details"
  | "bodyweight"
  | "life"
  | "meet_registered"
  | "meet_confidence"
  | "meet_success";

/** Every key the seeded form carries, in the order it asks them. */
export const SESSION_KEYS: readonly SessionKey[] = [
  "topics",
  "training_feel",
  "recovery",
  "pain",
  "pain_details",
  "bodyweight",
  "life",
  "meet_registered",
  "meet_confidence",
  "meet_success",
];

/** Each answer's short label, as the agenda and the coach read it. */
export const ANSWER_WORDS: Record<SessionKey, string> = {
  topics: "What they want to cover",
  training_feel: "Training feels",
  recovery: "Sleep and recovery",
  pain: "Physically",
  pain_details: "Where it hurts",
  bodyweight: "Morning bodyweight",
  life: "Coming up",
  meet_registered: "Registered for the meet",
  meet_confidence: "Feeling about the meet",
  meet_success: "A successful meet looks like",
};

/** Roughly how long each takes to answer on a phone, in seconds. */
const SECONDS: Record<SessionKey, number> = {
  topics: 40,
  training_feel: 5,
  recovery: 5,
  pain: 5,
  pain_details: 0, // only when they say something hurts, inside pain's time
  bodyweight: 10,
  life: 20,
  meet_registered: 5,
  meet_confidence: 5,
  meet_success: 30,
};

export type QuestionnaireInput = {
  /** the last weekly check-in, null when there's none */
  lastCheckin: string | null;
  /** the last weigh-in, null when there's none */
  lastWeighIn: string | null;
  today: string;
  event: { kind: string; daysOut: number | null } | null;
  /** a meet checklist already says they're registered */
  registeredKnown: boolean;
  /** what the athlete already sent for this call (their topics on the booking) */
  topicsKnown: boolean;
};

export type Questionnaire = { keys: SessionKey[]; minutes: number; reasons: string[] };

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** Only what's missing or stale: a fresh check-in covers how they feel, a fresh weigh-in their weight. */
export function questionnaireFor(x: QuestionnaireInput): Questionnaire {
  const keys: SessionKey[] = [];
  const reasons: string[] = [];
  if (!x.topicsKnown) keys.push("topics");
  const checkinStale = !x.lastCheckin || daysBetween(x.lastCheckin, x.today) > 7;
  if (checkinStale) {
    keys.push("training_feel", "recovery", "pain", "pain_details", "life");
    reasons.push(x.lastCheckin ? "Their last check-in is over a week old" : "No weekly check-in on file");
  }
  const weighStale = !x.lastWeighIn || daysBetween(x.lastWeighIn, x.today) > 7;
  if (weighStale) {
    keys.push("bodyweight");
    reasons.push(x.lastWeighIn ? "Their last weigh-in is over a week old" : "No weigh-in on file");
  }
  const meet = x.event?.kind === "competition" && x.event.daysOut != null && x.event.daysOut >= 0;
  if (meet) {
    if (!x.registeredKnown) keys.push("meet_registered");
    keys.push("meet_confidence", "meet_success");
    reasons.push("A meet is coming: how they feel about it, in their words");
  }
  const order = new Map(SESSION_KEYS.map((k, i) => [k, i]));
  const unique = [...new Set(keys)].sort((a, b) => order.get(a)! - order.get(b)!);
  const seconds = unique.reduce((s, k) => s + SECONDS[k], 0);
  return { keys: unique, minutes: Math.max(1, Math.min(3, Math.round(seconds / 60) || 1)), reasons };
}

type Q = { id: string; validation?: unknown };
const keyOf = (q: Q): string | null => {
  const v = (q.validation ?? {}) as Record<string, unknown>;
  return typeof v.session_key === "string" ? v.session_key : null;
};

/**
 * A send's questions: an assignment that names keys shows only those (and any
 * question without a key, a heading); every other assignment shows them all.
 */
export function askedQuestions<T extends Q>(questions: T[], askKeys: unknown): T[] {
  if (!Array.isArray(askKeys) || askKeys.length === 0) return questions;
  const ask = new Set(askKeys.map(String));
  return questions.filter((q) => {
    const k = keyOf(q);
    return k == null || ask.has(k);
  });
}

/** The answers by session key, from a submission's answers as text. */
export function answersByKey(questions: Array<Q & { label: string }>, textOf: (questionId: string) => string | null): Record<string, { label: string; text: string }> {
  const out: Record<string, { label: string; text: string }> = {};
  for (const q of questions) {
    const k = keyOf(q);
    if (!k) continue;
    const t = textOf(q.id)?.trim();
    if (t) out[k] = { label: q.label, text: t };
  }
  return out;
}
