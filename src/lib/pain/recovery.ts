/**
 * What the coach could do or suggest about a client's pain (pure, tested).
 * Each suggestion is earned by the history, never handed out by default:
 * a one-off mild soreness gets nothing, heat and soft-tissue work only for
 * muscular tightness or ache with no warning signs, an assessment once it's
 * persistent, worse, stopping sessions or showing a warning sign.
 *
 * Evidence the rules lean on: staying active beats rest for back and neck
 * pain; superficial heat eases pain and stiffness short term (comfort, not a
 * fix, and never on a fresh swelling); massage reduces perceived soreness
 * short term; tendon pain settles with load the area tolerates, not rest;
 * short sleep raises pain sensitivity; persistent or function-limiting pain
 * is a physio's job. Nothing here is a treatment or a diagnosis.
 *
 * Suggestions aren't repeated: one the coach already used for that place in
 * the last REPEAT_DAYS (pain_coach_reviews) is left out unless the place got
 * worse since, and a physio suggestion that didn't settle it becomes "follow
 * up on the physio".
 */
import { NON_TRAINING_REGIONS } from "@/lib/pain/regions";
import type { PainArea, PainHistory } from "@/lib/pain/history";
import { redFlags } from "@/lib/pain/safety";
import { associations, associationLine, sessionContext, type PainSession } from "@/lib/pain/sessions";

export type SuggestionKey =
  | "urgent"
  | "assess"
  | "follow_up"
  | "modify"
  | "load"
  | "keep_moving"
  | "heat"
  | "soft_tissue"
  | "sleep";

export type RecoverySuggestion = {
  key: SuggestionKey;
  /** The region it's about (null = overall, e.g. sleep). */
  region: string | null;
  area: string | null;
  /** What to consider, coach-facing. */
  title: string;
  /** Why, from their records. */
  why: string;
};

export type GivenSuggestion = { key: string; region: string | null; at: string };

export const REPEAT_DAYS = 21;

const MUSCULAR = new Set(["neck", "upper_back", "shoulder_blade", "mid_back", "low_back", "glute", "hamstring", "quad", "calf", "chest", "upper_arm", "ribs"]);
const SPINE = new Set(["neck", "upper_back", "mid_back", "low_back"]);
const TENDON_PRONE = new Set(["elbow", "knee", "shoulder", "ankle_foot", "wrist_hand", "hip_groin"]);
/** Where heat is the comfort measure (stiff, guarded muscle); everywhere else it's soft-tissue work. */
const HEAT_FIRST = new Set(["neck", "upper_back", "shoulder_blade", "mid_back", "low_back"]);
/** The most a place gets at once: what matters most, not a list. */
export const PER_AREA = 2;

const ORDER: SuggestionKey[] = ["urgent", "assess", "follow_up", "modify", "load", "keep_moving", "sleep", "heat", "soft_tissue"];

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Got worse after a suggestion was given (then it can be said again). */
function escalatedSince(a: PainArea, at: string): boolean {
  return a.entries.some((e) => e.at > at && (e.severity === "severe" || e.impact === "stopped" || (e.sameIssue && e.change === "worse")));
}

function areaSuggestions(a: PainArea, sessions: PainSession[], given: GivenSuggestion[], now: number): RecoverySuggestion[] {
  if (a.status === "quiet" || (a.minor && a.reasons.length === 0)) return [];
  const out: RecoverySuggestion[] = [];
  const add = (key: SuggestionKey, title: string, why: string) => out.push({ key, region: a.region, area: a.label, title, why });
  const flags = redFlags(a.entries.filter((e) => e.date >= addDays(a.last, -14)));
  const warm = a.feel.some((f) => f === "pop" || f === "swollen" || f === "numb");
  const ctx = sessionContext(a, sessions);
  const assoc = associations(a, sessions);
  const recurring = a.days >= 2;

  if (flags.some((f) => f.urgent)) add("urgent", "Ask about the urgent warning signs today", flags.filter((f) => f.urgent).map((f) => f.text).join(" "));

  // a general symptom, or the head, face or jaw: never a training change or a comfort measure, a doctor when it needs one
  if (a.cls === "general" || NON_TRAINING_REGIONS.has(a.region)) {
    const why = [
      flags.length ? flags.map((f) => f.text.split(":")[0]).join("; ").toLowerCase() : null,
      a.status === "persistent" || a.recentDays >= 3 ? `${a.recentDays} reports in the last 6 weeks` : null,
      a.trend === "worse" ? "getting worse" : null,
    ].filter(Boolean);
    if (why.length && !flags.some((f) => f.urgent)) add("assess", "Worth a doctor's look", `${why.join(", ")}.`);
    return out;
  }

  const assessWhy = [
    flags.length ? flags.map((f) => f.text.split(":")[0]).join("; ").toLowerCase() : null,
    a.status === "persistent" ? `${a.recentDays} reports over ${a.recentWeeks} weeks` : null,
    a.trend === "worse" ? "getting worse" : null,
    a.limiting.stopped ? "it stopped a session" : a.limiting.modified >= 2 ? `it changed ${a.limiting.modified} sessions` : null,
  ].filter(Boolean);
  if (assessWhy.length) {
    const before = given.find((g) => g.key === "assess" && g.region === a.region && Date.parse(g.at) >= Date.parse(`${addDays(a.last, -42)}T00:00:00Z`));
    if (before && a.entries.some((e) => e.at > before.at)) add("follow_up", "Follow up on getting it assessed", `You suggested a physio ${before.at.slice(0, 10)}; it's still coming up.`);
    else add("assess", "Get it assessed by a physio", `${assessWhy.join(", ")}.`);
  }

  const named = a.named.find((n) => n.count >= 2) ?? (assoc[0] ? { name: assoc[0].name, count: assoc[0].with } : null);
  if (named) {
    const why = a.named.find((n) => n.count >= 2) ? `They named ${named.name} ${named.count}×.` : `It ${associationLine(assoc[0])}.`;
    add("modify", `Modify ${named.name} before forcing it (grip, range, tempo, load, or a swap)`, why);
  }

  if (a.limiting.modified + a.limiting.stopped > 0 || a.trend === "worse" || (recurring && ctx.veryHard >= 2))
    add(
      "load",
      TENDON_PRONE.has(a.region) && !warm ? "Keep training it, at a load that doesn't flare it" : "Pull back the training stress on it for a week or two",
      ctx.veryHard >= 2 ? `${ctx.veryHard} of the sessions it came up in were rated very hard or max.` : a.limiting.modified + a.limiting.stopped > 0 ? "It's changing their sessions." : "It's getting worse.",
    );

  // backs and necks: keep moving, once it's more than a mild niggle
  if (SPINE.has(a.region) && !flags.length && recurring && (a.worstRecent !== "mild" || a.limiting.modified + a.limiting.stopped > 0))
    add("keep_moving", "Keep them moving: easy walking and normal movement within comfort", "Backs and necks settle faster with movement than rest.");

  // one comfort measure at most: muscular, tight or achy, no warning signs, more than a one-off
  const tightOrAche = a.feel.some((f) => f === "tight" || f === "ache" || f === "sore");
  const muscular = MUSCULAR.has(a.region) && !warm && a.worstRecent !== "severe";
  if (muscular && tightOrAche && recurring) {
    if (HEAT_FIRST.has(a.region)) add("heat", "Heat for comfort: a hot bath or heat pack", "It's tight or achy with no swelling or warning signs; heat can ease it short term, it won't fix it.");
    else add("soft_tissue", "Soft-tissue work: massage or foam rolling", "Can make tight, achy muscle feel better short term.");
  }

  // never repeat what the coach already suggested for this place, unless it got worse
  return out.filter((s) => {
    if (s.key === "urgent") return true;
    const last = given.filter((g) => g.key === s.key && (g.region === s.region || g.region == null)).sort((x, y) => y.at.localeCompare(x.at))[0];
    if (!last) return true;
    const recent = Date.parse(last.at) >= now - REPEAT_DAYS * 86_400_000;
    return !recent || escalatedSince(a, last.at);
  });
}

/**
 * Suggestions across their history: each place's (at most PER_AREA, in the
 * history's order, most pressing place first), then sleep once overall when
 * short sleep keeps lining up with pain.
 */
export function recoverySuggestions(history: PainHistory, sessions: PainSession[] = [], given: GivenSuggestion[] = [], now = Date.now()): RecoverySuggestion[] {
  const out: RecoverySuggestion[] = [];
  for (const a of history.areas) {
    const list = areaSuggestions(a, sessions, given, now).sort((x, y) => ORDER.indexOf(x.key) - ORDER.indexOf(y.key));
    out.push(...list.slice(0, PER_AREA));
  }
  const painDates = new Set(history.areas.filter((a) => a.status !== "quiet").flatMap((a) => a.entries.map((e) => e.date)));
  const painSessions = sessions.filter((s) => painDates.has(s.date)).slice(-4);
  const shortSleep = painSessions.filter((s) => s.sleep === "lt5" || s.sleep === "5_6").length;
  const sleepGiven = given.some((g) => g.key === "sleep" && Date.parse(g.at) >= now - REPEAT_DAYS * 86_400_000);
  if (shortSleep >= 2 && !sleepGiven)
    out.push({ key: "sleep", region: null, area: null, title: "Sleep: aim for 7+ hours", why: `They slept under 6 hours before ${shortSleep} of the last ${painSessions.length} sessions they reported pain.` });
  // most pressing place first (the history's order), each place's own in order
  return out;
}
