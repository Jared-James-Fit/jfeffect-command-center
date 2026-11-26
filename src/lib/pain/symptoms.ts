/**
 * What kind of symptom a report is (pure, tested; Nov 26 2026). One taxonomy
 * for the whole app: the review, the voice reader, recovery, the coach's
 * sheet, Cleo, programming and competition prep all read a report's kind from
 * here and nowhere else, so nobody calls the same report two things.
 *
 *   fatigue    heavy or tired muscles: estimated fatigue the athlete confirmed
 *   soreness   normal soreness after training (never during a lift)
 *   tightness  tight, stiff or cramping, with nothing sharp
 *   joint      discomfort at a joint or tendon (the knee, the patellar tendon)
 *   pain       sharp, pinching, burning, a pop or swelling, 7/10 or worse, or
 *              soreness that keeps coming back (history.ts upgrades it)
 *   nerve      numbness, tingling or weakness
 *   general    a symptom that isn't a muscle or joint: a headache, dizziness,
 *              nausea, feeling unwell. Never read as training fatigue, never
 *              tied to a muscle, never assumed to be from training.
 *
 * A kind says how a report is handled, never what's wrong: nothing here names
 * an injury or a condition. Kinds are worked out from what was reported (the
 * spot, what it feels like, how bad, when it hurts), never stored, so a
 * report reads the same everywhere and older reports get a kind too.
 */
import { NON_TRAINING_REGIONS } from "@/lib/pain/regions";
import { siteOf } from "@/lib/pain/sites";

export type SymptomClass = "fatigue" | "soreness" | "tightness" | "joint" | "pain" | "nerve" | "general";

export const SYMPTOM_CLASSES: { key: SymptomClass; label: string; short: string; about: string }[] = [
  { key: "nerve", label: "Numbness or tingling", short: "Numb / tingling", about: "Numbness, tingling or weakness." },
  { key: "pain", label: "Pain", short: "Pain", about: "Sharp, pinching or burning, a pop or swelling, 7/10 or worse, or soreness that keeps coming back." },
  { key: "joint", label: "Joint or tendon discomfort", short: "Joint / tendon", about: "Discomfort at a joint or tendon rather than in a muscle." },
  { key: "tightness", label: "Tightness", short: "Tight", about: "Tight, stiff or cramping, with nothing sharp." },
  { key: "soreness", label: "Training soreness", short: "Sore", about: "The normal soreness after training, felt later rather than during a lift." },
  { key: "fatigue", label: "Muscle fatigue", short: "Fatigued", about: "Muscles that feel heavy or tired." },
  { key: "general", label: "General symptom", short: "Symptom", about: "Not a muscle or joint: a headache, dizziness, nausea or feeling unwell." },
];

const CLASS_BY_KEY = new Map(SYMPTOM_CLASSES.map((c) => [c.key, c]));
export function classLabel(c: SymptomClass): string {
  return CLASS_BY_KEY.get(c)?.label ?? c;
}
export function classShort(c: SymptomClass): string {
  return CLASS_BY_KEY.get(c)?.short ?? c;
}

/** Most pressing first: what a place reads as when several reports differ. */
export const CLASS_ORDER: SymptomClass[] = ["nerve", "pain", "joint", "tightness", "soreness", "fatigue", "general"];

/** Kinds that limit how a place can be trained today (recovery caps the score for them, the coach looks). */
export function limitsTraining(c: SymptomClass): boolean {
  return c === "nerve" || c === "pain" || c === "joint";
}

/** Kinds that only confirm training fatigue: never a separate penalty on top of it. */
export function confirmsFatigue(c: SymptomClass): boolean {
  return c === "fatigue" || c === "soreness" || c === "tightness";
}

// ── general symptoms ─────────────────────────────────────────────────────

export type GeneralSymptom = "headache" | "dizziness" | "nausea" | "stomach" | "breathless" | "palpitations" | "fainted" | "illness" | "exhaustion";

export type GeneralSymptomDef = {
  key: GeneralSymptom;
  label: string;
  /** Where it's drawn: the head for a headache, nowhere ("general") for the rest. */
  region: "head" | "general";
  /** How people say it (lowercase text). */
  words: RegExp;
};

/**
 * Stored in `pain_reports.symptom` (keys never renamed). Order matters only
 * for reading words: "fainted" before "dizziness", "nausea" before "stomach".
 */
export const GENERAL_SYMPTOMS: readonly GeneralSymptomDef[] = [
  { key: "fainted", label: "Fainted or nearly fainted", region: "general", words: /\b(?:fainted|faint(?:ed)? and|passed out|blacked out|black ?out|lost consciousness|(?:nearly|almost) (?:fainted|passed out|blacked out))\b/ },
  { key: "headache", label: "Headache", region: "head", words: /\b(?:head ?aches?|migraines?|head (?:is |was )?(?:pounding|throbbing|splitting|killing me)|pounding head)\b/ },
  { key: "dizziness", label: "Dizziness or light-headedness", region: "general", words: /\b(?:dizz\w*|light[- ]?head(?:ed|edness)?|vertigo|room (?:was |is )?spinning|woozy|(?:felt|feel|feeling) faint)\b/ },
  { key: "nausea", label: "Nausea", region: "general", words: /\b(?:nause\w*|queasy|sick to (?:my|the) stomach|threw up|throw(?:ing)? up|vomit\w*|puk(?:e|ed|ing))\b/ },
  { key: "stomach", label: "Stomach upset or cramps", region: "general", words: /\b(?:stomach ?(?:ache|aches|cramps?|upset|pain|issues?|bug|problems?)|upset stomach|bloat(?:ed|ing)|gut (?:issues?|pain|problems?)|diarrh\w*)\b/ },
  { key: "breathless", label: "Short of breath", region: "general", words: /\b(?:short(?:ness)? of breath|can'?t (?:catch|get) my breath|breathless|hard to breathe|trouble breathing|struggling to breathe|wheez\w*)\b/ },
  { key: "palpitations", label: "Racing or pounding heart", region: "general", words: /\b(?:palpitations?|heart (?:was |is |keeps )?(?:racing|pounding|fluttering|skipping)|racing heart|pounding heart|skipped beats?|irregular heart ?beat)\b/ },
  { key: "illness", label: "Feeling sick or unwell", region: "general", words: /\b(?:sick(?! to (?:my|the) stomach)(?! of)|(?:a |the |got a |getting a |have a |caught a |coming down with a )cold|flu|fever\w*|covid|chills|sore throat|under the weather|unwell)\b/ },
  { key: "exhaustion", label: "Unusual exhaustion", region: "general", words: /\b(?:exhausted|wiped out|completely drained|no energy|run ?down|burnt out|burned out)\b/ },
];

const GENERAL_BY_KEY = new Map(GENERAL_SYMPTOMS.map((g) => [g.key, g]));
export const GENERAL_KEYS: ReadonlySet<string> = new Set(GENERAL_SYMPTOMS.map((g) => g.key));

export function generalOf(key: string | null | undefined): GeneralSymptomDef | null {
  return key ? GENERAL_BY_KEY.get(key as GeneralSymptom) ?? null : null;
}

export function generalLabel(key: string | null | undefined): string | null {
  return generalOf(key)?.label ?? null;
}

/** The general symptoms in someone's words, in the order they said them. */
export function generalSymptomsIn(text: string): GeneralSymptom[] {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  const found: { key: GeneralSymptom; at: number }[] = [];
  for (const g of GENERAL_SYMPTOMS) {
    const m = g.words.exec(t);
    if (!m) continue;
    // "nearly fainted" is fainting, not dizziness; "felt faint and dizzy" is both
    found.push({ key: g.key, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.key);
}

// ── a report's kind ──────────────────────────────────────────────────────

type ReportLike = {
  region: string;
  site?: string | null;
  feel?: readonly string[] | null;
  score?: number | null;
  severity?: string | null;
  timing?: readonly string[] | null;
  symptom?: string | null;
};

const SHARP = new Set(["sharp", "pinch", "burning", "pop", "swollen", "sudden"]);
const LOOSE = new Set(["tight", "cramp"]);
const ACHY = new Set(["sore", "ache"]);
/** A region with no spot picked reads as a joint when that's what it mostly is. */
const JOINT_REGIONS = new Set(["knee", "elbow", "wrist_hand", "ankle_foot", "jaw"]);

function scoreOf(r: ReportLike): number | null {
  if (typeof r.score === "number") return r.score;
  if (r.severity === "severe") return 8;
  if (r.severity === "moderate") return 5;
  if (r.severity === "mild") return 2;
  return null;
}

/**
 * The kind of one report, from what was reported. A spot that's a joint or
 * tendon is joint discomfort whatever it feels like ("my knee is sore" isn't
 * training soreness); soreness only counts when it isn't during a lift; with
 * nothing said about how it feels, a report reads as pain (it came from
 * "Anything hurt?"), never as something milder.
 */
export function symptomClass(r: ReportLike): SymptomClass {
  if (r.symptom && GENERAL_KEYS.has(r.symptom)) return "general";
  if (r.region === "general") return "general";
  const feel = r.feel ?? [];
  if (feel.includes("numb") || feel.includes("weak")) return "nerve";
  const score = scoreOf(r);
  if (feel.some((f) => SHARP.has(f)) || (score != null && score >= 7)) return "pain";
  const site = siteOf(r.site);
  const joint = site ? site.kind === "joint" || site.kind === "tendon" : JOINT_REGIONS.has(r.region);
  if (joint) return "joint";
  if (NON_TRAINING_REGIONS.has(r.region)) {
    // a head or face report with no symptom named: pain there, never "soreness"
    return "pain";
  }
  const during = (r.timing ?? []).includes("during");
  if (!feel.length) return "pain";
  if (feel.every((f) => f === "fatigued")) return "fatigue";
  if (feel.some((f) => LOOSE.has(f)) && !feel.some((f) => ACHY.has(f))) return during ? "pain" : "tightness";
  if (feel.some((f) => ACHY.has(f) || f === "fatigued")) return during ? "pain" : "soreness";
  if (feel.includes("pressure") || feel.includes("throbbing")) return "pain";
  return "pain";
}

/** The most pressing kind of several reports (one place over time). */
export function worstClass(classes: SymptomClass[]): SymptomClass | null {
  let best: SymptomClass | null = null;
  for (const c of classes) if (best == null || CLASS_ORDER.indexOf(c) < CLASS_ORDER.indexOf(best)) best = c;
  return best;
}
