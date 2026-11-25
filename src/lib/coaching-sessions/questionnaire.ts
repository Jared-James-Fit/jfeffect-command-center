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
  | "meet_success"
  | "unlogged";

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
  "unlogged",
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
  unlogged: "The unlogged workouts",
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
  unlogged: 5,
};

export type QuestionnaireInput = {
  /** the last weekly check-in, null when there's none */
  lastCheckin: string | null;
  /** the last weigh-in, null when there's none */
  lastWeighIn: string | null;
  today: string;
  event: { kind: string; daysOut: number | null; title?: string | null } | null;
  /** a meet checklist already says they're registered */
  registeredKnown: boolean;
  /** what the athlete already sent for this call (their topics on the booking) */
  topicsKnown: boolean;
  /** an unresolved pain report: its place and when it was last reported */
  painOpen?: { label: string; since: string | null } | null;
  /** planned workouts in the last 4 weeks with nothing logged */
  unlogged?: number;
  /** a bodyweight number matters for this meeting (a class to make, a dated goal) */
  bodyweightMatters?: boolean;
};

/**
 * The questions worth sending, the labels that make them theirs, why, and
 * whether sending is worth it at all (`useful`: one question that tells the
 * coach something the records can't). Three at most, plus an optional
 * "anything else" that's never required.
 */
export type Questionnaire = { keys: SessionKey[]; minutes: number; reasons: string[]; labels: Partial<Record<SessionKey, string>>; useful: boolean };

/** At most this many questions that matter (the optional note is extra). */
export const MAX_QUESTIONS = 3;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const shortDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Only what the records can't tell the coach, ranked by what it changes in the
 * meeting: an open pain report's status, whether unlogged sessions were
 * trained, the meet registration, how training has felt when there's no
 * recent check-in, a weigh-in when bodyweight matters, how they feel about a
 * close meet. Never a question the records answer, never "what do you need
 * help with" (that's the coach's to work out), never homework.
 */
export function questionnaireFor(x: QuestionnaireInput): Questionnaire {
  const picks: Array<{ key: SessionKey; why: string; label?: string; rank: number }> = [];
  const meet = x.event?.kind === "competition" && x.event.daysOut != null && x.event.daysOut >= 0 ? x.event.daysOut : null;
  if (x.painOpen)
    picks.push({
      key: "pain",
      rank: 1,
      why: `Their ${x.painOpen.label.toLowerCase()} was reported${x.painOpen.since ? ` on ${shortDay(x.painOpen.since)}` : ""}: how it is now changes what you recommend`,
      label: `How's your ${x.painOpen.label.toLowerCase()} feeling now?`,
    });
  if ((x.unlogged ?? 0) >= 2)
    picks.push({
      key: "unlogged",
      rank: 2,
      why: `${x.unlogged} planned workouts have nothing logged: trained or not decides the conversation`,
      label: `${x.unlogged} of your planned workouts lately have nothing logged. Did you train them?`,
    });
  if (meet != null && meet <= 42 && !x.registeredKnown) picks.push({ key: "meet_registered", rank: 3, why: "A meet is coming and registration isn't on file" });
  const checkinStale = !x.lastCheckin || daysBetween(x.lastCheckin, x.today) > 10;
  if (checkinStale)
    picks.push({
      key: "training_feel",
      rank: 4,
      why: x.lastCheckin ? `Their last check-in was ${shortDay(x.lastCheckin)}` : "No weekly check-in on file",
      label: "How has training felt this past week?",
    });
  const weighStale = !x.lastWeighIn || daysBetween(x.lastWeighIn, x.today) > 7;
  if (weighStale && (x.bodyweightMatters || (meet != null && meet <= 56)))
    picks.push({ key: "bodyweight", rank: 5, why: x.lastWeighIn ? `The last weigh-in was ${shortDay(x.lastWeighIn)}` : "No weigh-in on file" });
  if (meet != null && meet <= 28) picks.push({ key: "meet_confidence", rank: 6, why: "How they feel about the meet, in their words" });
  if (checkinStale) picks.push({ key: "life", rank: 7, why: "Anything coming up that changes the plan" });

  const chosen = picks.sort((a, b) => a.rank - b.rank).slice(0, MAX_QUESTIONS);
  const keys: SessionKey[] = chosen.map((c) => c.key);
  if (keys.includes("pain")) keys.push("pain_details");
  const labels: Partial<Record<SessionKey, string>> = {};
  for (const c of chosen) if (c.label) labels[c.key] = c.label;
  const useful = chosen.length > 0;
  // the optional note: their own topics, never required, only alongside questions worth sending
  if (useful && !x.topicsKnown) {
    keys.push("topics");
    labels.topics = "Anything else you want to make sure we cover? (optional)";
  }
  const order = new Map(SESSION_KEYS.map((k, i) => [k, i]));
  const unique = [...new Set(keys)].sort((a, b) => (a === "topics" ? 1 : b === "topics" ? -1 : order.get(a)! - order.get(b)!));
  const seconds = unique.reduce((s, k) => s + (k === "topics" ? 0 : SECONDS[k]), 0);
  return {
    keys: unique,
    minutes: Math.max(1, Math.min(2, Math.round(seconds / 60) || 1)),
    reasons: chosen.map((c) => c.why),
    labels,
    useful,
  };
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
export function askedQuestions<T extends Q>(questions: T[], askKeys: unknown, labels?: unknown): T[] {
  if (!Array.isArray(askKeys) || askKeys.length === 0) return questions;
  const ask = new Set(askKeys.map(String));
  const own = labels && typeof labels === "object" ? (labels as Record<string, unknown>) : {};
  return questions
    .filter((q) => {
      const k = keyOf(q);
      return k == null || ask.has(k);
    })
    .map((q) => {
      // a send can word a question for this client ("How's your left knee feeling now?")
      const k = keyOf(q);
      const label = k ? own[k] : null;
      return typeof label === "string" && label.trim() ? ({ ...q, label: label.trim().slice(0, 200) } as T) : q;
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

/**
 * Where each answer belongs in the prep, in the form's order: a routine
 * answer ("Good", "Yes", "Nothing") is never a concern to raise on the call.
 * A good answer is a win in their words, a worry is theirs to talk about,
 * not being registered is the coach's to chase, and anything the seeded
 * options don't cover (a coach's own edit of the form) is kept as said.
 */
export type RoutedAnswers = { goingWell: string[]; theirs: string[]; coach: string[]; plan: string[] };

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const saidNothing = (s: string) => /^(no|none|nope|nothing|n\/a|na|not really|all good)\.?$/i.test(s.trim());

export function routeAnswers(answers: Record<string, string>): RoutedAnswers {
  const out: RoutedAnswers = { goingWell: [], theirs: [], coach: [], plan: [] };
  const a = (k: SessionKey) => answers[k]?.trim() ?? "";
  for (const k of SESSION_KEYS) {
    const v = a(k);
    if (!v || k === "topics" || k === "pain_details") continue;
    switch (k) {
      case "training_feel":
        if (v === "Great" || v === "Good") out.goingWell.push(`Training feels ${lower(v)}`);
        else out.theirs.push(`Training feels: ${lower(v)}`);
        break;
      case "recovery":
        if (v === "Sleeping and recovering well") out.goingWell.push("Sleeping and recovering well");
        else if (v !== "Mostly fine") out.theirs.push(`Sleep and recovery: ${lower(v)}`);
        break;
      case "pain": {
        if (v === "Nothing") break;
        const where = a("pain_details");
        out.theirs.push(`Physically: ${lower(v)}${where ? ` (${where})` : ""}`);
        break;
      }
      case "bodyweight":
        out.plan.push(`Morning bodyweight: ${v}`);
        break;
      case "life":
        if (!saidNothing(v)) out.theirs.push(`Coming up: ${v}`);
        break;
      case "meet_registered":
        if (v !== "Yes") out.coach.push(`Registered for the meet: ${lower(v)}`);
        break;
      case "meet_confidence":
        if (v === "Confident" || v === "Good") out.goingWell.push(`Feeling ${lower(v)} about the meet`);
        else out.theirs.push(`Feeling about the meet: ${lower(v)}`);
        break;
      case "meet_success":
        out.theirs.push(`A successful meet looks like: ${v}`);
        break;
      case "unlogged":
        if (/^yes/i.test(v)) out.goingWell.push("Trained the sessions that weren't logged");
        else out.theirs.push(`The unlogged workouts: ${lower(v)}`);
        break;
    }
  }
  // a pain detail with no pain answer (an older form) still reaches the coach
  if (!a("pain") && a("pain_details")) out.theirs.push(`Physically: ${a("pain_details")}`);
  // anything this form didn't seed, as they said it
  for (const [k, v] of Object.entries(answers))
    if (!(SESSION_KEYS as readonly string[]).includes(k) && v?.trim()) out.theirs.push(`${k}: ${v.trim()}`);
  return out;
}
