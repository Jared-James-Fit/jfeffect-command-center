/**
 * What Cleo remembers about a client (pure, tested in meeting-memory.test.ts):
 * lasting coaching knowledge kept as compact rows the coach reviews in bulk.
 *
 *  - category: Goals · Preferences · Constraints · Decisions · Coaching
 *    insights (the stored kinds folded into five a coach scans in seconds);
 *  - scope: ongoing, temporary (with an end date) or tied to one event;
 *  - review: a new line that says what a kept line already says is a
 *    duplicate (merged, never shown twice); one that says the opposite of a
 *    kept line is a conflict (the coach picks); a temporary line past its date
 *    or an event line after its event is outdated;
 *  - auto-keep: only explicit, low-risk, non-conflicting lines in the
 *    client's own words (a preference, a goal, an achievement) are kept
 *    without a tap, marked so the coach can undo; anything uncertain,
 *    sensitive (health, family, money, body image, relationships) or
 *    consequential (a decision, a constraint) waits for the coach.
 */
import { normalizeWords } from "./analysis";

export type MemoryCategory = "goals" | "preferences" | "constraints" | "decisions" | "insights";
export const CATEGORY_WORDS: Record<MemoryCategory, string> = {
  goals: "Goals",
  preferences: "Preferences",
  constraints: "Constraints",
  decisions: "Decisions",
  insights: "Coaching insights",
};
export const CATEGORY_ORDER: MemoryCategory[] = [
  "goals",
  "preferences",
  "constraints",
  "decisions",
  "insights",
];

const KIND_CATEGORY: Record<string, MemoryCategory> = {
  goal: "goals",
  achievement: "goals",
  preference: "preferences",
  constraint: "constraints",
  concern: "constraints",
  decision: "decisions",
  training_response: "insights",
  approach: "insights",
  technique: "insights",
  relationship: "insights",
  other: "insights",
};

export function categoryOf(kind: string): MemoryCategory {
  return KIND_CATEGORY[kind] ?? "insights";
}

export type MemoryRow = {
  id: string;
  kind: string;
  text: string;
  status: "proposed" | "confirmed" | "archived";
  permanence: "lasting" | "temporary";
  expires_on: string | null;
  event_key?: string | null;
  event_title?: string | null;
  event_date?: string | null;
  auto_kept?: boolean | null;
  source_quote?: string | null;
  source_session_id?: string | null;
  review_reason?: string | null;
  duplicate_of?: string | null;
  conflicts_with?: string | null;
  merged_count?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type Scope = "ongoing" | "temporary" | "event";
export function scopeOf(m: Pick<MemoryRow, "permanence" | "event_key">): Scope {
  if (m.event_key) return "event";
  return m.permanence === "temporary" ? "temporary" : "ongoing";
}

/* ------------------------------------------------------------------ */

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "their",
  "them",
  "they",
  "she",
  "her",
  "his",
  "him",
  "has",
  "have",
  "had",
  "was",
  "are",
  "is",
  "to",
  "of",
  "a",
  "an",
  "in",
  "on",
  "at",
  "it",
  "be",
  "that",
  "this",
  "wants",
  "want",
  "likes",
  "like",
  "prefers",
  "prefer",
  "really",
]);
const contentWords = (t: string) =>
  normalizeWords(t)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));

/** How much two lines share, 0..1 (their content words, against the shorter). */
export function overlap(a: string, b: string): number {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}

const NEG =
  /\b(not|no|never|doesnt|dont|isnt|wont|cant|dislikes?|hates?|avoid|avoids|stopped|quit|without)\b/;
const OPPOSITES: Array<[RegExp, RegExp]> = [
  [/\bmorning\b/, /\b(evening|night)\b/],
  [/\bmore\b/, /\bless\b/],
  [/\bincrease\b/, /\b(decrease|reduce)\b/],
  [/\bcut(ting)?\b/, /\b(bulk(ing)?|gain(ing)?)\b/],
  [/\bkg\b/, /\blb\b/],
];

/** Two lines about the same thing that say opposite things. */
export function contradicts(a: string, b: string): boolean {
  const na = normalizeWords(a);
  const nb = normalizeWords(b);
  if (overlap(a, b) < 0.5) {
    // the same topic with opposite words ("trains in the morning" / "trains in the evening")
    const sharedTopic =
      overlap(
        a.replace(/morning|evening|night|more|less|increase|decrease|reduce|cut|bulk|gain/gi, ""),
        b.replace(/morning|evening|night|more|less|increase|decrease|reduce|cut|bulk|gain/gi, ""),
      ) >= 0.6;
    if (!sharedTopic) return false;
  }
  if (NEG.test(na) !== NEG.test(nb)) return true;
  return OPPOSITES.some(
    ([x, y]) =>
      (x.test(na) && y.test(nb) && !y.test(na)) || (y.test(na) && x.test(nb) && !x.test(na)),
  );
}

/** Words that make a line sensitive: never kept without the coach. */
const SENSITIVE =
  /\b(injur|pain|surgery|doctor|diagnos|medic|medication|pregnan|period|cycle|eating disorder|anorex|bulim|binge|depress|anxi|therapy|therap|mental|suicid|divorce|partner|husband|wife|boyfriend|girlfriend|family|kids?|child|money|debt|afford|salary|job loss|fired|body image|hate my body|weight shame|drink|alcohol|drug|steroid|trt|testosterone)/i;
/** Kinds that are consequential: a decision or a constraint changes what's prescribed. */
const CONSEQUENTIAL = new Set([
  "decision",
  "constraint",
  "concern",
  "relationship",
  "training_response",
  "approach",
]);
/** Kinds safe to keep from the client's explicit words. */
const LOW_RISK = new Set(["preference", "goal", "achievement"]);

export type CandidateReview =
  | { action: "auto_keep"; reason: string }
  | { action: "duplicate"; of: string; reason: string }
  | { action: "conflict"; with: string; reason: string }
  | { action: "review"; reason: string };

/**
 * What happens to a line Cleo took from a meeting, before the coach sees it.
 * `speakerConfirmed` is whether the transcript says who said it (an
 * unconfirmed speaker is never auto-kept: it could be the coach's words).
 */
export function reviewCandidate(
  c: { kind: string; text: string; quote: string; basis?: string | null; speaker?: string | null },
  kept: Array<Pick<MemoryRow, "id" | "text" | "kind" | "status">>,
  opts: { allowAutoKeep: boolean; speakerConfirmed: boolean },
): CandidateReview {
  const live = kept.filter((k) => k.status === "confirmed");
  const dup = live.find((k) => overlap(k.text, c.text) >= 0.8 && !contradicts(k.text, c.text));
  if (dup) return { action: "duplicate", of: dup.id, reason: "Already remembered" };
  const clash = live.find(
    (k) => categoryOf(k.kind) === categoryOf(c.kind) && contradicts(k.text, c.text),
  );
  if (clash)
    return {
      action: "conflict",
      with: clash.id,
      reason: "Says the opposite of something already remembered",
    };
  if (!opts.allowAutoKeep) return { action: "review", reason: "Waiting for you" };
  if (!LOW_RISK.has(c.kind) || CONSEQUENTIAL.has(c.kind))
    return { action: "review", reason: "Changes what's prescribed: yours to confirm" };
  if (SENSITIVE.test(`${c.text} ${c.quote}`))
    return { action: "review", reason: "Sensitive: yours to confirm" };
  if (c.basis && c.basis !== "confirmed")
    return { action: "review", reason: "Only floated in the conversation" };
  if (!opts.speakerConfirmed || c.speaker !== "athlete")
    return { action: "review", reason: "Not clear who said it" };
  if (/\b(maybe|might|probably|not sure|think|guess|kind of)\b/i.test(c.quote))
    return { action: "review", reason: "Said with a hedge" };
  return { action: "auto_keep", reason: "Said plainly by them, low-risk" };
}

/** A kept line that's past its use: a temporary one after its date, an event one after its event. */
export function isOutdated(
  m: Pick<MemoryRow, "status" | "permanence" | "expires_on" | "event_date">,
  today: string,
): boolean {
  if (m.status !== "confirmed") return false;
  if (m.permanence === "temporary" && m.expires_on && m.expires_on < today) return true;
  if (m.event_date && m.event_date < today) return true;
  return false;
}

export type MemoryGroup = { category: MemoryCategory; title: string; rows: MemoryRow[] };

/** Rows for the panel: what needs review first, then each category's kept lines. */
export function memoryBoard(rows: MemoryRow[], today: string) {
  const live = rows.filter((r) => r.status !== "archived");
  const pending = live.filter((r) => r.status === "proposed");
  const outdated = live.filter((r) => isOutdated(r, today));
  const kept = live.filter((r) => r.status === "confirmed" && !isOutdated(r, today));
  const groups: MemoryGroup[] = CATEGORY_ORDER.map((category) => ({
    category,
    title: CATEGORY_WORDS[category],
    rows: kept.filter((r) => categoryOf(r.kind) === category),
  })).filter((g) => g.rows.length);
  const conflicts = pending.filter((r) => r.conflicts_with);
  return {
    pending,
    conflicts,
    outdated,
    groups,
    autoKept: kept.filter((r) => r.auto_kept),
    total: kept.length,
  };
}
