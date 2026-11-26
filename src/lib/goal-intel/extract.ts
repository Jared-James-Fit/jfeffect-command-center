/**
 * Goals read from what people said (pure, tested in goal-intel.test.ts): a
 * meeting's analysis and the coach's notes from the call, a weekly check-in's
 * answers, a client's own chat messages. Deterministic and strict: nothing
 * here calls a model (the meeting analysis already quoted the transcript and
 * checked every quote), and nothing invents a number, a unit or a date.
 *
 *  - a measurable goal needs a lift (or the total, or bodyweight) and a number
 *    next to it; a range stays a range ("220 to 225");
 *  - the unit is the one said; when none was said it's read from the athlete's
 *    own training numbers (which unit makes the number a believable target for
 *    that lift) and marked inferred, for the coach to confirm;
 *  - numbers that are reps, sets, RPE, percentages, days or a date are never
 *    targets;
 *  - a goal said in words ("wants to keep growing muscle") is kept in words;
 *  - how they want to go about it ("top end over nine for nine") is a
 *    preference, kept with the event it's about.
 *
 * Every candidate keeps the quote it came from. All of it lands as proposed:
 * only the coach makes a goal a target.
 */
import { normalizeWords } from "@/lib/coaching-sessions/analysis";
import { LB_PER_KG, type GoalKind, type Lift, type Unit } from "./types";

export type GoalCandidate = {
  kind: GoalKind;
  lift: Lift | null;
  /** one value, or a range's two ends (as said) */
  values: number[];
  unit: Unit | null;
  /** a meet attempt ("third"), the meet itself, or a goal by a date */
  timing: "third" | "second" | "opener" | "meet" | null;
  /** the goal in words (for one with no number, the whole of it) */
  text: string;
  quote: string;
  tentative: boolean;
};

const LIFT_WORDS: Array<{ lift: Lift | "total"; re: RegExp }> = [
  { lift: "squat", re: /\bsquats?\b/i },
  { lift: "bench", re: /\bbench(?:ing)?(?:\s+press)?\b/i },
  { lift: "deadlift", re: /\bdead\s?lifts?\b|\bdeads\b|\bpulls?\b(?=\s*(?:of|at|around|[-–]|\d))/i },
  { lift: "total", re: /\btotal(?:ing)?\b/i },
];
const BODYWEIGHT = /\b(body ?weight|weigh(?:ing)? in|weigh-in|weight class|make weight|cut (?:down )?to|get down to|drop to|bulk to|weigh (?:about|around)?)\b/i;
const UNIT_KG = /^(kg|kgs|kilo|kilos|kilogram|kilograms)$/i;
const UNIT_LB = /^(lb|lbs|pound|pounds)$/i;
const HEDGES = /\b(maybe|might|probably|i think|thinking|hopefully|hoping|we ?ll see|not sure|could|try|around|about|ish)\b/i;
const GOAL_VERBS =
  /\b(goal|aim(?:ing)?|want(?:s|ed)? to|wanna|hoping to|trying to|target|get (?:to|up to|down to)|hit(?:ting)?|pr|personal best|by (?:the )?(?:meet|summer|end of|next)|third|3rd|opener|attempt|thirds)\b/i;

/** Numbers that sit next to reps, sets, RPE, a percentage, a time or a date are never targets. */
const NOT_A_LOAD_AFTER = /^\s*(%|percent|reps?|sets?|x\b|×|rpe|rir|weeks?|wks?|days?|months?|minutes?|mins?|sec|seconds?|hours?|kg\s*\/\s*week|lbs?\s*\/\s*week|am|pm|th\b|st\b|nd\b|rd\b)/i;
const NOT_A_LOAD_BEFORE = /(@|\brpe|\brir|(?:^|[\s\d])x|×|#|\$|\bweeks?|\bdays?|\/)\s*$/i;

type NumHit = { value: number; index: number; end: number; unit: Unit | null };

/** The numbers in a piece of text that could be a load or a bodyweight, with any unit right after. */
export function loadNumbers(text: string): NumHit[] {
  const out: NumHit[] = [];
  const re = /(\d{2,4}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(",", ".");
    const value = Number(raw);
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    const after = text.slice(m.index + m[1].length, m.index + m[1].length + 14);
    // a year, a time, a date
    if (/^\d{4}$/.test(m[1]) && value >= 1900 && value <= 2100) continue;
    if (/^\s*[:\/]\d/.test(after) || /\d[:\/]\s*$/.test(before)) continue;
    if (NOT_A_LOAD_AFTER.test(after) || NOT_A_LOAD_BEFORE.test(before)) continue;
    if (!Number.isFinite(value) || value < 20 || value > 1500) continue;
    const u = after.match(/^\s*([a-z]+)/i)?.[1] ?? "";
    const unit: Unit | null = UNIT_KG.test(u) ? "kg" : UNIT_LB.test(u) ? "lb" : null;
    out.push({ value, index: m.index, end: m.index + m[1].length, unit });
  }
  return out;
}

/** "220 to 225", "220-225", "110, maybe 115", "anywhere from 264 to 280": one range. Else the first number. */
function valuesFrom(seg: string, nums: NumHit[]): { values: number[]; unit: Unit | null } | null {
  if (!nums.length) return null;
  const a = nums[0];
  const b = nums[1];
  if (b) {
    const between = seg.slice(a.end, b.index);
    if (/^\s*(kg|kgs|lbs?|pounds?|kilos?)?\s*(to|-|–|—|or|,\s*(maybe|or)?|\/|and)\s*$/i.test(between) && b.value >= a.value && b.value <= a.value * 1.25) {
      return { values: [a.value, b.value], unit: b.unit ?? a.unit };
    }
  }
  return { values: [a.value], unit: a.unit };
}

const timingOf = (t: string): GoalCandidate["timing"] =>
  /\b(third|3rd|thirds)\b/i.test(t) ? "third" : /\b(second|2nd)\s+attempt/i.test(t) ? "second" : /\b(opener|first attempt)\b/i.test(t) ? "opener" : /\b(meet|comp|competition|platform|attempt)\b/i.test(t) ? "meet" : null;

/**
 * The measurable goals in a line of text: each lift named with a number after
 * it (before the next lift is named), the total, a bodyweight. Several lifts
 * in one line ("squat 220-225, bench 110-115, deadlift 264-280") are several
 * goals.
 */
export function measurableGoals(text: string, quote = text): GoalCandidate[] {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  const hits = LIFT_WORDS.flatMap(({ lift, re }) => {
    const g = new RegExp(re.source, "gi");
    const xs: Array<{ lift: Lift | "total"; index: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) xs.push({ lift, index: m.index, end: m.index + m[0].length });
    return xs;
  }).sort((a, b) => a.index - b.index);
  const out: GoalCandidate[] = [];
  const tentative = HEDGES.test(quote) || HEDGES.test(t);
  const timing = timingOf(hits.length ? t.slice(0, hits[0].index) : t);
  const seen = new Set<string>();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const segEnd = hits[i + 1]?.index ?? t.length;
    const seg = t.slice(h.end, segEnd);
    const nums = loadNumbers(seg);
    const v = valuesFrom(seg, nums);
    if (!v) continue;
    const key = `${h.lift}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: h.lift === "total" ? "total" : "lift",
      lift: h.lift === "total" ? null : h.lift,
      values: v.values,
      unit: v.unit,
      timing: timingOf(seg) ?? timing,
      text: t.trim().slice(0, 300),
      quote: String(quote ?? t).trim().slice(0, 600),
      tentative,
    });
  }
  if (!out.length && BODYWEIGHT.test(t)) {
    const m = t.match(BODYWEIGHT)!;
    const nums = loadNumbers(t.slice(m.index ?? 0));
    const v = valuesFrom(t.slice(m.index ?? 0), nums);
    if (v && v.values[0] >= 30 && v.values[0] <= 400) {
      out.push({ kind: "bodyweight", lift: null, values: v.values, unit: v.unit, timing: null, text: t.trim().slice(0, 300), quote: String(quote).trim().slice(0, 600), tentative });
    }
  }
  return out;
}

const PREFERENCE = /\b(top end|top-end|9 ?\/ ?9|nine for nine|go for it|play it safe|safe(?:ly)?|conservative|aggressive|send it|no expectations|don.?t care about)\b/i;
const PHYSIQUE = /\b(muscle|grow(?:ing|th)?|bigger|size|lean(?:er)?|physique|abs|glutes?|shoulders?|arms?|tone|toned|shred(?:ded)?|body ?fat|aesthetic|build(?:ing)? muscle)\b/i;
const STRENGTH = /\b(stronger|strength|strong|total|pr|personal best|lift more)\b/i;
const EVENT = /\b(qualif(?:y|ied|ication)|nationals|provincials|worlds|podium|win|compete|competition|meet|show|stage)\b/i;

/**
 * A goal said in words, with nothing to measure: physique (muscle, size,
 * leaner), strength ("get stronger"), an event (qualify, podium), or a
 * preference about the approach. Null when the line isn't a goal at all.
 */
export function wordedGoal(text: string, quote = text): GoalCandidate | null {
  const t = String(text ?? "").trim();
  if (t.length < 8) return null;
  const tentative = HEDGES.test(quote);
  const base: Omit<GoalCandidate, "kind"> = { lift: null, values: [], unit: null, timing: null, text: t.slice(0, 600), quote: String(quote).trim().slice(0, 600), tentative };
  if (PREFERENCE.test(t) || PREFERENCE.test(quote)) return { ...base, kind: "preference" };
  if (PHYSIQUE.test(t)) return { ...base, kind: "physique" };
  if (EVENT.test(t) && /\b(qualif|podium|win|nationals|provincials|worlds|compete)/i.test(t)) return { ...base, kind: "event" };
  if (STRENGTH.test(t)) return { ...base, kind: "performance" };
  return null;
}

/** A client's own words that say a measurable goal (a check-in answer, a chat message): strict. */
export function statedGoals(text: string): GoalCandidate[] {
  const t = String(text ?? "");
  if (t.length < 8 || t.length > 4000) return [];
  const out: GoalCandidate[] = [];
  // one sentence at a time, so a quote is the sentence it was said in
  for (const sentence of t.split(/(?<=[.!?\n])\s+/)) {
    if (!GOAL_VERBS.test(sentence)) continue;
    // past results aren't goals ("hit 100 last week", "got 225 today")
    if (/\b(last (?:week|time|session)|yesterday|today i|just hit|got|did|made|hit it|smoked)\b/i.test(sentence) && !/\b(want|goal|aim|hoping|next)\b/i.test(sentence)) continue;
    for (const c of measurableGoals(sentence, sentence)) out.push(c);
  }
  return out;
}

/* ------------------------------------------------------------------ */

/**
 * The unit of a number nobody gave a unit for, read from the athlete's own
 * numbers: a target is believable when it's 70–140% of their current lift (or
 * 80–125% of their bodyweight). When exactly one unit makes it believable,
 * that's the one (inferred); when both or neither do, it's their training
 * unit (inferred) and flagged.
 */
export function inferUnit(x: { values: number[]; kind: GoalKind; currentKg: number | null; preferred: Unit }): { unit: Unit; source: "stated" | "inferred"; note: string | null } {
  const v = Math.max(...x.values);
  if (!x.currentKg || x.currentKg <= 0) return { unit: x.preferred, source: "inferred", note: `No unit said: read as ${x.preferred}, their training unit. Confirm it.` };
  const [lo, hi] = x.kind === "bodyweight" ? [0.8, 1.25] : [0.7, 1.4];
  const fits = (unit: Unit) => {
    const kg = unit === "lb" ? v / LB_PER_KG : v;
    const r = kg / (x.currentKg as number);
    return r >= lo && r <= hi;
  };
  const kg = fits("kg");
  const lb = fits("lb");
  if (kg !== lb) {
    const unit: Unit = kg ? "kg" : "lb";
    return { unit, source: "inferred", note: `No unit said: ${unit} fits their training numbers.` };
  }
  return { unit: x.preferred, source: "inferred", note: `No unit said and the number doesn't fit their training clearly: read as ${x.preferred}. Confirm it.` };
}

/** The key that makes one goal one row: what it's about and when. */
export function dedupeKey(x: { kind: GoalKind; lift: Lift | null; competitionId: string | null; deadline: string | null; text?: string | null; names?: string[] }): string {
  const when = x.competitionId ? `comp:${x.competitionId}` : x.deadline ? `date:${x.deadline}` : "open";
  if (x.kind === "lift") return `lift:${x.lift}:${when}`;
  if (x.kind === "total" || x.kind === "bodyweight") return `${x.kind}:${when}`;
  if (x.kind === "preference") return `preference:${when}`;
  // a goal in words: its three most telling words
  const names = new Set((x.names ?? []).map((n) => normalizeWords(n)).filter(Boolean));
  const words = normalizeWords(x.text ?? "")
    .split(" ")
    .filter((w) => w.length > 3 && !WORD_STOP.has(w) && !names.has(w))
    .slice(0, 12)
    .sort()
    .slice(0, 3)
    .join("-");
  return `${x.kind}:${words || "general"}`;
}
const WORD_STOP = new Set([
  "wants", "want", "still", "while", "also", "keep", "keeps", "their", "they", "them", "that", "this", "with", "from", "into", "would", "could", "should",
  "says", "said", "feels", "toward", "back", "after", "before", "about", "more", "really", "getting", "going", "being",
]);

/** A short title for a goal ("Squat · Total Fortification", "Bodyweight by Mar 1"). */
export function goalTitle(x: { kind: GoalKind; lift: Lift | null; eventTitle: string | null; deadline: string | null; timing?: GoalCandidate["timing"]; text?: string | null }): string {
  const what =
    x.kind === "lift"
      ? `${x.lift === "squat" ? "Squat" : x.lift === "bench" ? "Bench" : "Deadlift"}${x.timing === "third" ? " third attempt" : x.timing === "opener" ? " opener" : ""}`
      : x.kind === "total"
        ? "Total"
        : x.kind === "bodyweight"
          ? "Bodyweight"
          : x.kind === "preference"
            ? "Approach"
            : x.kind === "physique"
              ? "Physique"
              : x.kind === "performance"
                ? "Strength"
                : "Event";
  if (x.eventTitle) return `${what} · ${x.eventTitle}`.slice(0, 160);
  if (x.deadline) {
    const d = new Date(`${x.deadline}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return `${what} by ${d}`.slice(0, 160);
  }
  return what;
}
