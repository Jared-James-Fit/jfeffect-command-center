/**
 * What a meeting's notes or transcript say, checked before the coach sees it
 * (pure, tested in coaching-sessions.test.ts). The model reads the transcript
 * as data and answers in a fixed shape; code then keeps only what the
 * conversation supports:
 *
 *  - every item, recommendation, intelligence line and contradiction must
 *    quote the transcript (quoteFound: the words in order, or nearly), else
 *    it's dropped and listed as dropped;
 *  - an "agreement" whose own words hedge ("maybe", "we'll see", "let's try")
 *    is tentative, never a decision; so is a hedged commitment;
 *  - a recommendation carries no number the transcript or the records don't
 *    hold, and at most five survive (no changes for the sake of it);
 *  - lasting intelligence the coach already confirmed isn't proposed twice;
 *  - Cleo's interpretations are labelled as such, never as what was said.
 *
 * The transcript can't instruct anything: nothing here acts, every change is
 * a proposal the coach decides on, and words that try to give instructions
 * are only ever text in a field.
 */
import { numbersIn, ungroundedNumbers } from "@/lib/competition/grounding";
import { parseJsonObject } from "./brief";
import { ambiguousLoads, unitCheckLine } from "./units";

export type Basis = "confirmed" | "tentative" | "interpretation";
export type ItemKind =
  | "agreement"
  | "tentative"
  | "athlete_commitment"
  | "coach_commitment"
  | "concern"
  | "goal"
  | "win"
  | "open_question"
  /** coaching feedback the coach gave */
  | "feedback"
  /** a measurable objective set in the meeting */
  | "objective";
export type Speaker = "coach" | "athlete" | "unclear";

export type AnalysisItem = { kind: ItemKind; text: string; quote: string; speaker: Speaker; due: string | null; basis: Basis };

export const REC_AREAS = ["training", "nutrition", "cardio", "recovery", "schedule", "competition", "communication", "coaching"] as const;
export type RecArea = (typeof REC_AREAS)[number];
export type AnalysisRecommendation = {
  area: RecArea;
  kind: "change" | "keep";
  title: string;
  current: string;
  proposed: string;
  reason: string;
  quotes: string[];
  benefit: string;
  tradeoffs: string;
  affects: string;
  basis: Basis;
  /** what needs the coach's check before it's used (an unconfirmed unit) */
  flags?: string[];
};

export const INTEL_KINDS = ["goal", "preference", "training_response", "approach", "decision", "technique", "constraint", "achievement", "relationship", "concern", "other"] as const;
export type IntelKind = (typeof INTEL_KINDS)[number];
export type IntelCandidate = { kind: IntelKind; text: string; permanence: "lasting" | "temporary"; expiresOn: string | null; quote: string; speaker?: Speaker; event?: boolean };

export type Contradiction = { text: string; quote: string; against: string };

export type MeetingAnalysis = {
  summary: string;
  items: AnalysisItem[];
  recommendations: AnalysisRecommendation[];
  intelligence: IntelCandidate[];
  contradictions: Contradiction[];
  /** private to the coach: how the conversation went, never sent */
  feedback: { strengths: string[]; consider: string[] };
  followUp: { level: string; when: string; why: string } | null;
  /** loads said without a clear unit, to confirm before they're used */
  unitChecks?: string[];
  dropped: string[];
};

/* ------------------------------------------------------------------ */

/** Words only: lowercase, apostrophes and punctuation gone, one space between. */
export function normalizeWords(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’‛′`']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const shingles = (words: string[], n: number) => {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
};

/**
 * The quote is in the transcript: its words in order, or (allowing a
 * transcription slip or a reworded filler word) three in four of its word
 * pairs are there AND at least four of its words run exactly as said. Under
 * three words is too little to check, so it doesn't count.
 */
export function quoteFound(quote: string, transcriptNorm: string, transcriptPairs?: Set<string>): boolean {
  const q = normalizeWords(quote);
  const words = q.split(" ").filter(Boolean);
  if (words.length < 3) return false;
  const padded = ` ${transcriptNorm} `;
  if (padded.includes(` ${q} `)) return true;
  if (words.length < 5) return false;
  const pairs = transcriptPairs ?? new Set(shingles(transcriptNorm.split(" "), 2));
  const qp = shingles(words, 2);
  const share = qp.filter((p) => pairs.has(p)).length / qp.length;
  if (share < 0.75) return false;
  for (let i = 0; i + 4 <= words.length; i++) if (padded.includes(` ${words.slice(i, i + 4).join(" ")} `)) return true;
  return false;
}

const HEDGE =
  /\b(maybe|might|could|possibly|perhaps|probably|not sure|we ?ll see|lets see|think about|thinking about|try|trying|consider|i guess|kind of|sort of|see how|if it|depending)\b/;

/** The words themselves hold back from a decision. */
export function hedged(quote: string): boolean {
  return HEDGE.test(normalizeWords(quote));
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);
const ITEM_KINDS: ItemKind[] = ["agreement", "tentative", "athlete_commitment", "coach_commitment", "concern", "goal", "win", "open_question", "feedback", "objective"];
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type CheckContext = {
  today: string;
  /** numbers the records hold (the prep, the plans), allowed in recommendations */
  recordNumbers?: unknown;
  /** confirmed lasting intelligence, not proposed again */
  knownIntelligence?: string[];
  /** the client's training unit, for loads said in the meeting */
  clientUnit?: "kg" | "lb" | null;
  /** recommendations already decided in recent meetings: not proposed again */
  recentRecommendations?: string[];
};

/** Two titles say the same thing (most of their words in common). */
export function sameIdea(a: string, b: string): boolean {
  // "4th" and "fourth", "Saturdays" and "Saturday" are the same word here
  const stem = (w: string) => ORDINALS[w] ?? (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  const words = (t: string) => new Set(normalizeWords(t).split(" ").map(stem).filter((w) => w.length > 2 && !STOP.has(w)));
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) >= 0.7;
}
const ORDINALS: Record<string, string> = { "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth", "5th": "fifth", "6th": "sixth", "7th": "seventh" };
const STOP = new Set(["the", "and", "for", "with", "their", "them", "they", "your", "you", "from", "into", "this", "that", "keep", "more", "less", "each", "week", "weeks", "then"]);

/** Read and check a model's analysis against the transcript it was given. */
export function checkAnalysis(text: string, transcript: string, ctx: CheckContext): MeetingAnalysis | null {
  const raw = parseJsonObject(text);
  if (!raw) return null;
  const norm = normalizeWords(transcript);
  const sh = new Set(shingles(norm.split(" "), 2));
  const found = (q: string) => quoteFound(q, norm, sh);
  const dropped: string[] = [];
  const allowed = numbersIn([transcript, ctx.recordNumbers ?? null]);

  const items: AnalysisItem[] = [];
  for (const r of list(raw.items) as any[]) {
    const kind = ITEM_KINDS.includes(r?.kind) ? (r.kind as ItemKind) : null;
    const t = clip(r?.text, 300);
    const quote = clip(r?.quote, 400);
    if (!kind || !t) continue;
    if (!found(quote)) {
      dropped.push(`"${t.slice(0, 70)}": no matching words in the transcript`);
      continue;
    }
    const hedges = hedged(quote);
    let k: ItemKind = kind;
    let basis: Basis = r?.basis === "interpretation" ? "interpretation" : hedges ? "tentative" : "confirmed";
    if (kind === "agreement" && (hedges || basis !== "confirmed")) k = "tentative";
    if (k === "tentative") basis = basis === "interpretation" ? "interpretation" : "tentative";
    const speaker: Speaker = r?.speaker === "coach" || r?.speaker === "athlete" ? r.speaker : "unclear";
    // a commitment is someone's: one nobody can be named for is an open question
    if ((k === "athlete_commitment" || k === "coach_commitment") && speaker === "unclear" && basis === "confirmed") basis = "tentative";
    const due = isDate(r?.due) && r.due >= ctx.today ? r.due : null;
    items.push({ kind: k, text: t, quote, speaker, due, basis });
  }

  const recommendations: AnalysisRecommendation[] = [];
  for (const r of list(raw.recommendations) as any[]) {
    const area = REC_AREAS.includes(r?.area) ? (r.area as RecArea) : null;
    const title = clip(r?.title, 200);
    if (!area || !title) continue;
    const quotes = list(r?.quotes).map((q) => clip(q, 400)).filter((q) => found(q));
    if (!quotes.length) {
      dropped.push(`Recommendation "${title.slice(0, 70)}": nothing in the conversation supports it`);
      continue;
    }
    const rec: AnalysisRecommendation = {
      area,
      kind: r?.kind === "keep" ? "keep" : "change",
      title,
      current: clip(r?.current, 600),
      proposed: clip(r?.proposed, 600),
      reason: clip(r?.reason, 800),
      quotes: quotes.slice(0, 3),
      benefit: clip(r?.benefit, 400),
      tradeoffs: clip(r?.tradeoffs, 400),
      affects: clip(r?.affects, 300),
      basis: r?.basis === "interpretation" ? "interpretation" : quotes.some((q) => !hedged(q)) ? "confirmed" : "tentative",
    };
    const bad = ungroundedNumbers([rec.title, rec.current, rec.proposed, rec.reason].join(" "), allowed);
    if (bad.length) {
      dropped.push(`Recommendation "${title.slice(0, 70)}": numbers that weren't said or on file (${bad.join(", ")})`);
      continue;
    }
    if (rec.kind === "change" && !rec.proposed) {
      dropped.push(`Recommendation "${title.slice(0, 70)}": no change was described`);
      continue;
    }
    if ((ctx.recentRecommendations ?? []).some((t) => sameIdea(t, rec.title))) {
      dropped.push(`Recommendation "${title.slice(0, 70)}": already decided in a recent meeting`);
      continue;
    }
    if (recommendations.some((r) => sameIdea(r.title, rec.title))) continue;
    if (rec.area === "training" || rec.area === "competition" || rec.area === "nutrition") {
      const loads = ambiguousLoads([rec.current, rec.proposed, ...rec.quotes].join(" \n "), ctx.clientUnit ?? null);
      if (loads.length) rec.flags = loads.map((c) => unitCheckLine(c, ctx.clientUnit ?? null));
    }
    recommendations.push(rec);
  }
  if (recommendations.length > 5) {
    dropped.push(`${recommendations.length - 5} lower-priority recommendations left out (five at most)`);
    recommendations.length = 5;
  }

  const known = new Set((ctx.knownIntelligence ?? []).map(normalizeWords));
  const intelligence: IntelCandidate[] = [];
  for (const r of list(raw.intelligence) as any[]) {
    const kind = (INTEL_KINDS as readonly string[]).includes(r?.kind) ? (r.kind as IntelKind) : "other";
    const t = clip(r?.text, 600);
    const quote = clip(r?.quote, 600);
    if (t.length < 3) continue;
    if (!found(quote)) {
      dropped.push(`"${t.slice(0, 70)}": no matching words in the transcript`);
      continue;
    }
    if (known.has(normalizeWords(t))) continue;
    const temporary = r?.permanence === "temporary";
    const expiresOn = temporary ? (isDate(r?.expires_on) && r.expires_on > ctx.today ? r.expires_on : addDays(ctx.today, 28)) : null;
    const speaker: Speaker = r?.speaker === "coach" || r?.speaker === "athlete" ? r.speaker : "unclear";
    intelligence.push({ kind, text: t, permanence: temporary ? "temporary" : "lasting", expiresOn, quote, speaker, event: r?.scope === "event" || r?.event === true });
  }

  const contradictions: Contradiction[] = [];
  for (const r of list(raw.contradictions) as any[]) {
    const t = clip(r?.text, 400);
    const quote = clip(r?.quote, 400);
    const against = clip(r?.against, 300);
    if (!t || !against || !found(quote)) continue;
    contradictions.push({ text: t, quote, against });
  }

  const fb = (raw.feedback ?? {}) as any;
  const f = (raw.follow_up ?? raw.followUp) as any;
  return {
    summary: clip(raw.summary, 1200),
    items: items.slice(0, 30),
    recommendations,
    intelligence: intelligence.slice(0, 12),
    contradictions: contradictions.slice(0, 6),
    feedback: {
      strengths: list(fb.strengths).map((s) => clip(s, 240)).filter(Boolean).slice(0, 3),
      consider: list(fb.consider).map((s) => clip(s, 240)).filter(Boolean).slice(0, 3),
    },
    followUp: f && typeof f === "object" && clip(f.level, 40) ? { level: clip(f.level, 40), when: clip(f.when, 120), why: clip(f.why, 300) } : null,
    // across the whole conversation, only loads for a meet (attempts are where a wrong unit costs a result)
    unitChecks: ambiguousLoads(transcript, ctx.clientUnit ?? null, { meetOnly: true }).slice(0, 6).map((c) => unitCheckLine(c, ctx.clientUnit ?? null)),
    dropped,
  };
}

/** The transcript as the model reads it: clipped, with anything shaped like a fence marker neutralized. */
export function transcriptForModel(text: string, max = 60_000): { text: string; clipped: boolean } {
  const t = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<\/?transcript>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? { text: t.slice(0, max), clipped: true } : { text: t, clipped: false };
}

/**
 * A transcript file as plain text: subtitle files (.srt, .vtt) lose their cue
 * numbers and timestamps, an Otter .txt keeps its speaker lines, and blank
 * runs collapse. Nothing is reworded.
 */
export function plainTranscript(name: string, raw: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  let t = String(raw ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (ext === "srt" || ext === "vtt" || /^WEBVTT/.test(t)) {
    t = t
      .split("\n")
      .filter((l) => !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^(NOTE|STYLE|REGION)\b/.test(l))
      .join("\n");
  }
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}


/** Private, extractive review: scan all text, surface evidence for coach review.
 * Never infer a speaker from their words, invent a commitment or send data outside the app.
 */
export function privateMeetingAnalysis(raw: string, decisions: string[] = [], today = new Date().toISOString().slice(0, 10)): MeetingAnalysis {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const items: AnalysisItem[] = [...new Set(decisions.map(clean).filter(Boolean))].slice(0, 30)
    .map((text) => ({ kind: hedged(text) ? "tentative" : "agreement", text: text.slice(0, 300),
      quote: text.slice(0, 400), speaker: "unclear", due: null, basis: hedged(text) ? "tentative" : "confirmed" }));
  const intelligence: IntelCandidate[] = [];
  const recommendations: AnalysisRecommendation[] = [];
  const seen = new Set<string>();
  const topics = [
    { kind: "constraint", label: "Lifestyle or routine", pattern: /\b(liv(?:e|ing) (?:alone|by myself|on my own)|mov(?:e|ing|ed) (?:out|house|to)|(?:parents|family) (?:are|will be|went|have gone) (?:away|to|on)|(?:work|school|exam|shift|travel|vacation|holiday|schedule|childcare|commute).{0,65}\b(?:change|busy|late|early|away|week|month|hours?|days?|hard|can't|cannot|start|finish|affect|different|time)\b|(?:can|can't|cannot|only|unable to) (?:train|work out|go to the gym))\b/i, ask: "Check whether the routine change affects training availability, meals or consistency." },
    { kind: "preference", label: "Coaching preference", pattern: /\b(?:i (?:prefer|like|dislike|hate|enjoy|would rather|find it easier)|works better for me|works best for me)\b.{0,120}\b(?:train|gym|exercise|workout|lift|squat|bench|deadlift|food|meal|eat|cook|cardio|walk|check.?in|message|call|morning|evening|accountability|schedule)/i, ask: "Confirm the preference and consider it in the relevant coaching plan." },
    { kind: "constraint", label: "Nutrition routine", pattern: /\b(?:i|we|my)\b.{0,90}\b(?:meal prep|grocer(?:y|ies)|cook(?:ing)?|eating|meals?|food)\b.{0,70}\b(?:hard|difficult|skip|miss|struggle|time|can't|cannot|changed|busy|alone|every day|usually|instead)\b/i, ask: "Ask whether meal planning or nutrition support would help." },
    { kind: "concern", label: "Recovery consideration", pattern: /\b(?:i|my)\b.{0,80}\b(?:sleep|tired|fatigue|exhausted|stress(?:ed)?|recover(?:y|ing)?)\b.{0,65}\b(?:poor|hard|little|less|more|bad|lately|hours?|struggl|work|week|month|affect|better|worse|enough)\w*\b/i, ask: "Clarify whether recovery needs monitoring or a coaching adjustment." },
    { kind: "goal", label: "Stated goal", pattern: /\b(?:my goal is|i want to|i'm aiming to|i am aiming to|i hope to)\b.{0,100}\b(?:train|lift|compete|squat|bench|deadlift|strength|weight|muscle|fitness|consistent|exercise|nutrition|run|walk)\w*\b/i, ask: "Confirm the target and whether it belongs in the existing goal record." },
    { kind: "constraint", label: "Training access", pattern: /\b(?:i|my|we)\b.{0,90}\b(?:equipment|gym|barbell|dumbbells?|machines?)\b.{0,60}\b(?:access|available|only|don't|cannot|can't|closed|limited|home|no)\b/i, ask: "Confirm equipment access before changing exercise selection." },
  ] as const;
  let speaker: Speaker = "unclear";
  const followups = new Set<string>();
  for (const line of raw.split(/\n+/)) {
    const labelled = line.match(/^\s*(?:\[\d{1,2}:\d{2}(?::\d{2})?\]\s*)?([^:\n]{1,45}):\s*(.*)$/);
    if (labelled) {
      speaker = /^(client|athlete)$/i.test(labelled[1].trim()) ? "athlete" : /^coach$/i.test(labelled[1].trim()) ? "coach" : "unclear";
    } else if (/^\s*(?:speaker\s+\w+|unknown speaker)\b/i.test(line)) speaker = "unclear";
    if (speaker === "coach") continue;
    const body = labelled ? labelled[2] : line;
    for (const sentence of body.match(/[^.!?]+[.!?]*/g) ?? [body]) {
      const quote = clean(sentence).slice(0, 500);
      if (quote.length < 18 || quote.endsWith("?") || hedged(quote)) continue;
      const t = topics.find((topic) => topic.pattern.test(quote));
      if (!t || !/\b(?:i|my|we|our|parents)\b/i.test(quote)) continue;
      const key = normalizeWords(quote);
      if (seen.has(key)) continue;
      seen.add(key);
      // Evidence is a proposed observation, never automatically a client fact.
      const temporary = t.kind !== "preference" && /\b(?:this|next|last|for|until|away|currently|temporary|lately|right now)\b/i.test(quote);
      const duration = quote.match(/\b(?:for\s+)?(\d{1,2}|one|two|three|four|five|six)\s+(week|month)s?\b/i);
      const units: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      const amount = duration ? Number(duration[1]) || units[duration[1].toLowerCase()] || 1 : 0;
      const expiry = temporary ? addDays(today, duration ? Math.min(365, amount * (duration[2].toLowerCase() === "month" ? 30 : 7)) : 28) : null;
      if (intelligence.length < 20) intelligence.push({ kind: t.kind, text: quote, quote, speaker, permanence: temporary ? "temporary" : "lasting", expiresOn: expiry });
      if (!followups.has(t.label) && recommendations.length < 5) {
        followups.add(t.label);
        recommendations.push({ area: "coaching", kind: "change", title: t.ask, current: "", proposed: t.ask, reason: "Potential coaching relevance; verify the statement and speaker first.", quotes: [quote], benefit: "Personalize support using confirmed circumstances.", tradeoffs: "No plan change until confirmed.", affects: t.label, basis: "interpretation" });
      }
    }
  }
  // Only explicit, labelled promises. No deadlines or ownership guesses.
  for (const line of raw.split(/\n+/)) {
    const m = line.match(/^\s*(coach|client|athlete):\s*(.+)$/i);
    if (!m) continue;
    const quote = clean(m[2]).slice(0, 400);
    if (!/\b(?:i will|i'll|i’ll)\s+(?:send|upload|check|book|schedule|complete|update|review|track|log|message|follow up|confirm|bring|prepare|fill)\b/i.test(quote) || hedged(quote) || quote.endsWith("?")) continue;
    const role = m[1].toLowerCase() === "coach" ? "coach" : "athlete";
    if (items.length < 30 && !items.some(i => normalizeWords(i.quote) === normalizeWords(quote))) items.push({ kind: role === "coach" ? "coach_commitment" : "athlete_commitment", text: quote, quote, speaker: role, due: null, basis: "confirmed" });
  }
  const summary = intelligence.length
    ? "Found " + intelligence.length + " coaching-relevant observation" + (intelligence.length === 1 ? "" : "s") + " to review across the conversation. Confirm the source and relevance before using them in plans."
    : "No clear coaching-relevant observations were identified by private extraction. Review the source if more context is needed.";
  return { summary, items, recommendations, intelligence, contradictions: [],
    feedback: { strengths: [], consider: [] }, followUp: null, dropped: [] };
}
