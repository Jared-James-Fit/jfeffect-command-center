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

export type Basis = "confirmed" | "tentative" | "interpretation";
export type ItemKind = "agreement" | "tentative" | "athlete_commitment" | "coach_commitment" | "concern" | "goal" | "win" | "open_question";
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
};

export const INTEL_KINDS = ["goal", "preference", "training_response", "approach", "decision", "technique", "constraint", "achievement", "relationship", "concern", "other"] as const;
export type IntelKind = (typeof INTEL_KINDS)[number];
export type IntelCandidate = { kind: IntelKind; text: string; permanence: "lasting" | "temporary"; expiresOn: string | null; quote: string };

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
const ITEM_KINDS: ItemKind[] = ["agreement", "tentative", "athlete_commitment", "coach_commitment", "concern", "goal", "win", "open_question"];
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type CheckContext = {
  today: string;
  /** numbers the records hold (the prep, the plans), allowed in recommendations */
  recordNumbers?: unknown;
  /** confirmed lasting intelligence, not proposed again */
  knownIntelligence?: string[];
};

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
    intelligence.push({ kind, text: t, permanence: temporary ? "temporary" : "lasting", expiresOn, quote });
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
