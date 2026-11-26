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
const SAID_KG = /\b(kgs?|kilos?|kilograms?)\b|\dkgs?\b/i;
const SAID_LB = /\b(lbs?|pounds?)\b|\dlbs?\b/i;
const HEDGES = /\b(maybe|might|probably|i think|thinking|hopefully|hoping|we ?ll see|not sure|could|try|around|about|ish)\b/i;
/** Saying a goal: a past result ("hit", "PR") alone never is. */
const GOAL_VERBS =
  /\b(goal|aim(?:ing)?|want(?:s|ed)? to|wanna|hoping to|trying to|target|get (?:to|up to|down to)|by (?:the )?(?:meet|summer|end of|next)|third|3rd|opener|attempt|thirds|plan(?:ning)? (?:to|for|on))\b/i;
/** A coach's notes count only under goal or attempt words. */
const NOTE_GOAL_WORDS = /\b(goals?|targets?|third|thirds|3rd|openers?|attempts?|aim(?:ing)?|wants?|plan(?:ning)? (?:to|for))\b/i;

/** Numbers that sit next to reps, sets, RPE, a percentage, food, a time or a date are never targets. */
const NOT_A_LOAD_AFTER =
  /^\s*(?:kg|kgs|lbs?)?\s*(%|percent|reps?\b|sets?\b|x\s*\d|x\b|×|@\s*(?:\d|rpe)|rpe|rir|weeks?|wks?|days?|months?|minutes?|mins?|sec|seconds?|hours?|kg\s*\/\s*week|lbs?\s*\/\s*week|am\b|pm\b|th\b|st\b|nd\b|rd\b|g\b|grams?|cals?\b|kcals?|calories|carbs?|protein|fats?\b|steps|for\s+(?:a\s+)?(?:\d|single|double|triple|reps?|sets?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen))/i;
const NOT_A_LOAD_BEFORE = /(@|\brpe|\brir|(?:^|[\s\d])x|×|#|\$|\bweeks?|\bdays?|\/|\+)\s*$/i;
/** A change, not a target ("up 20 lbs", "add 10", "lose 5 kg"). */
const CHANGE_BEFORE = /\b(up|add(?:ing|ed)?|another|extra|gain(?:ed)?|lose|lost|drop(?:ped)?|increase(?:d)?(?: by)?|by)\s*$/i;
/** A working set ("3x5 at 405", "5 reps at 140"). */
const SET_BEFORE = /\d\s*(?:[x×]\s*\d+\s*)?(?:reps?\s*|sets?\s*)?(?:at|@)\s*$/i;
const MONTH_BEFORE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*$/i;
/** Where they are now, or were: never a target ("currently 170", "I weigh 185 right now", "520 last meet"). */
const CURRENT_BEFORE = /\b(currently|right now|at the moment|now at|i(?:'m| am) at|was|used to|last (?:meet|time|week|block|year))\b[^.;,\n]{0,20}$/i;
const CURRENT_AFTER = /^\s*(?:kgs?|lbs?|pounds?)?\s*(?:right now|currently|now\b|at the moment|today|yesterday|ago\b|as of|last (?:meet|time|week|block|year|month))/i;

type NumHit = { value: number; index: number; end: number; unit: Unit | null };

/** The numbers in a piece of text that could be a load or a bodyweight, with any unit right after. */
export function loadNumbers(text: string): NumHit[] {
  const out: NumHit[] = [];
  // "1,500" is one number; "180,190" two; "102,5" a decimal; never a piece of a longer number
  const re = /(?<![\d.])([1-9],\d{3}(?!\d)|\d{2,4}(?:\.\d{1,2}|,\d(?!\d))?(?!\d))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = /^\d,\d{3}$/.test(m[1]) ? m[1].replace(",", "") : m[1].replace(",", ".");
    const value = Number(raw);
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    const after = text.slice(m.index + m[1].length, m.index + m[1].length + 24);
    // a year, a time, a date
    if (/^\d{4}$/.test(m[1]) && value >= 1900 && value <= 2100) continue;
    if (/^\s*[:\/]\d/.test(after) || /\d[:\/]\s*$/.test(before)) continue;
    if (NOT_A_LOAD_AFTER.test(after) || NOT_A_LOAD_BEFORE.test(before.slice(-8))) continue;
    if (CHANGE_BEFORE.test(before) || SET_BEFORE.test(before) || MONTH_BEFORE.test(before)) continue;
    if (!Number.isFinite(value) || value < 20 || value > 1500) continue;
    const u = after.match(/^\s*([a-z]+)/i)?.[1] ?? "";
    const unit: Unit | null = UNIT_KG.test(u) ? "kg" : UNIT_LB.test(u) ? "lb" : null;
    out.push({ value, index: m.index, end: m.index + m[1].length, unit });
  }
  return out;
}

/** Is this number where they are (or were), not where they want to be? */
function isCurrent(text: string, n: NumHit): boolean {
  return CURRENT_BEFORE.test(text.slice(Math.max(0, n.index - 48), n.index)) || CURRENT_AFTER.test(text.slice(n.end, n.end + 30));
}

const RANGE_BETWEEN = /^\s*(kg|kgs|lbs?|pounds?|kilos?)?\s*(to|-|–|—|or|,\s*(maybe|or)?|\/|and)\s*$/i;

/** "220 to 225", "220-225", "110, maybe 115", "anywhere from 264 to 280": one range. Else the first number. */
function valuesFrom(seg: string, nums: NumHit[]): { values: number[]; unit: Unit | null } | null {
  if (!nums.length) return null;
  const a = nums[0];
  const b = nums[1];
  if (b) {
    const between = seg.slice(a.end, b.index);
    if (RANGE_BETWEEN.test(between) && b.value >= a.value && b.value <= a.value * 1.25) {
      return { values: [a.value, b.value], unit: b.unit ?? a.unit };
    }
  }
  return { values: [a.value], unit: a.unit };
}

const timingOf = (t: string): GoalCandidate["timing"] =>
  /\b(third|3rd|thirds)\b/i.test(t) ? "third" : /\b(second|2nd)\s+attempt/i.test(t) ? "second" : /\b(opener|first attempt)\b/i.test(t) ? "opener" : /\b(meet|comp|competition|platform|attempt)\b/i.test(t) ? "meet" : null;

type Hit = { what: Lift | "total" | "bodyweight"; index: number; end: number };

function findHits(t: string): Hit[] {
  const all: Hit[] = [];
  for (const { lift, re } of LIFT_WORDS) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) all.push({ what: lift, index: m.index, end: m.index + m[0].length });
  }
  const b = new RegExp(BODYWEIGHT.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = b.exec(t))) all.push({ what: "bodyweight", index: m.index, end: m.index + m[0].length });
  all.sort((x, y) => x.index - y.index || y.end - x.end);
  // overlapping words are one hit (the first)
  return all.filter((h, i) => !all.slice(0, i).some((p) => h.index < p.end));
}

/** A number right before a lift on the same line ("a 405 squat", "83kg bodyweight"), with a range before it. */
function numberBefore(t: string, h: Hit, nums: NumHit[]): { values: number[]; unit: Unit | null; used: NumHit[] } | null {
  const k = nums.findIndex((n, i) => n.end <= h.index && (nums[i + 1]?.end ?? Infinity) > h.index);
  if (k < 0) return null;
  const n = nums[k];
  if (!/^[ \t]*-?[ \t]*(?:kg|kgs|kilos?|lbs?|pounds?)?[ \t]*-?[ \t]*$/i.test(t.slice(n.end, h.index))) return null;
  const p = nums[k - 1];
  if (p && RANGE_BETWEEN.test(t.slice(p.end, n.index)) && !/\n/.test(t.slice(p.end, n.index)) && n.value >= p.value && n.value <= p.value * 1.25) {
    return { values: [p.value, n.value], unit: n.unit ?? p.unit, used: [p, n] };
  }
  return { values: [n.value], unit: n.unit, used: [n] };
}

/**
 * The measurable goals in a line of text: each lift (the total, a bodyweight)
 * with its number, whether the number comes after the word ("squat 220-225")
 * or before it ("a 405 squat", "500 total, 180 squat"): which way the text
 * reads is decided by its first lift. Several lifts in one line are several
 * goals; a number only ever belongs to one of them. Where they are now, a
 * change ("up 20"), a working set and a date are never the number.
 */
export function measurableGoals(text: string, quote = text): GoalCandidate[] {
  const t = String(text ?? "");
  if (!t.trim()) return [];
  const hits = findHits(t);
  if (!hits.length) return [];
  const nums = loadNumbers(t).filter((n) => !isCurrent(t, n));
  const q = String(quote ?? t);
  const separateQuote = q.trim() !== t.trim();
  const out: GoalCandidate[] = [];
  const timing = timingOf(t);
  const seen = new Set<string>();
  const before = new Map<Hit, NonNullable<ReturnType<typeof numberBefore>>>();
  for (const h of hits) {
    const b = numberBefore(t, h, nums);
    if (b) before.set(h, b);
  }
  const usedBefore = new Set(Array.from(before.values()).flatMap((b) => b.used));
  const after = (h: Hit, i: number) => nums.filter((n) => n.index >= h.end && n.index < (hits[i + 1]?.index ?? t.length));
  // which way the text reads: the first lift that has a number decides
  const firstIdx = hits.findIndex((h, i) => before.has(h) || after(h, i).length > 0);
  const numberFirst = firstIdx >= 0 && before.has(hits[firstIdx]);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    let v: { values: number[]; unit: Unit | null } | null = null;
    if (numberFirst && before.has(h)) v = before.get(h)!;
    else {
      const own = after(h, i).filter((n) => !(numberFirst && usedBefore.has(n)));
      const end = hits[i + 1]?.index ?? t.length;
      v = valuesFrom(t.slice(h.end, end), own.map((n) => ({ ...n, index: n.index - h.end, end: n.end - h.end })));
    }
    if (!v) continue;
    if (h.what === "bodyweight" && (v.values[0] < 30 || v.values[0] > 400)) continue;
    if (seen.has(h.what)) continue;
    seen.add(h.what);
    // a unit counts as said only when the words said it (an analysis's own paraphrase doesn't)
    let unit = v.unit;
    if (unit && separateQuote && !(unit === "kg" ? SAID_KG : SAID_LB).test(q)) unit = null;
    const qNums = (q.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    const inQuote = !separateQuote || v.values.every((x) => qNums.includes(x));
    out.push({
      kind: h.what === "total" ? "total" : h.what === "bodyweight" ? "bodyweight" : "lift",
      lift: h.what === "total" || h.what === "bodyweight" ? null : h.what,
      values: v.values,
      unit,
      timing: h.what === "bodyweight" ? null : timing,
      text: t.trim().slice(0, 300),
      quote: q.trim().slice(0, 600),
      tentative: HEDGES.test(q) || HEDGES.test(t) || !inQuote,
    });
  }
  return out;
}

/** The parts of a coach's call notes that are about goals or attempts (a header like "Thirds:" covers the lines under it). */
export function goalNotes(notes: string): string {
  const keep: string[] = [];
  let section = false;
  for (const raw of String(notes ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/:\s*$/.test(line)) {
      section = NOTE_GOAL_WORDS.test(line);
      if (section) keep.push(line);
      continue;
    }
    if (section || NOTE_GOAL_WORDS.test(line)) keep.push(line);
  }
  return keep.join("\n");
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
    // past results aren't goals ("hit 100 last week", "got 225 today", "new PR")
    if (/\b(last (?:week|time|session)|yesterday|today i|just hit|hit|got|did|made|hit it|smoked|pr|prs|pr'd|personal best|felt)\b/i.test(sentence) && !/\b(want|goal|aim|hoping|next|target|plan)\b/i.test(sentence)) continue;
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
