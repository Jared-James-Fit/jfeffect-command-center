/**
 * One pain report: a place that hurt after a workout (or in a weekly
 * check-in), how bad, and whatever else the athlete chose to add. Pure and
 * shared by the review sheet, the server and every reader.
 *
 * Only the place and how bad are asked for; everything else is a tap away and
 * optional. A place that came up before asks one short question instead of
 * the whole form again: "Same as Nov 16? Better / Same / Worse / Something
 * new". Only the athlete's answer ties two reports together (`sameIssue`):
 * two reports in one spot are never assumed to be one injury.
 */
import { z } from "zod";
import { PAIN_REGIONS, areaLabel, legacyAreaText, regionOf, type PainSide } from "@/lib/pain/regions";
import { SITE_KEYS, siteLabel, siteOf } from "@/lib/pain/sites";
import { GENERAL_SYMPTOMS, generalLabel, generalOf, type GeneralSymptom } from "@/lib/pain/symptoms";

const GENERAL_SYMPTOM_KEYS = GENERAL_SYMPTOMS.map((g) => g.key) as [GeneralSymptom, ...GeneralSymptom[]];

export type Severity = "mild" | "moderate" | "severe";
export type Trigger = "training" | "exercise" | "daily" | "unsure";
export type Impact = "none" | "modified" | "stopped";
export type Change = "better" | "same" | "worse";
export type Feel =
  | "sore" | "tight" | "ache" | "sharp" | "pinch" | "numb" | "swollen" | "pop" | "burning" | "other"
  // Nov 26 2026: the whole body (symptoms.ts reads them)
  | "fatigued" | "cramp" | "weak" | "pressure" | "throbbing" | "sudden";

/** Every feel the database takes (the migration's CHECK lists the same). */
export const FEEL_KEYS: readonly Feel[] = ["sore", "tight", "ache", "sharp", "pinch", "numb", "swollen", "pop", "burning", "other", "fatigued", "cramp", "weak", "pressure", "throbbing", "sudden"];
/** When it hurts (the review asks; older reports said what set it off instead). */
export type Timing = "during" | "after" | "rest" | "movement";

export const SEVERITIES: { v: Severity; label: string; level: number }[] = [
  { v: "mild", label: "Mild", level: 3 },
  { v: "moderate", label: "Moderate", level: 5 },
  { v: "severe", label: "Severe", level: 8 },
];

export const TRIGGERS: { v: Trigger; label: string }[] = [
  { v: "training", label: "Training" },
  { v: "exercise", label: "An exercise" },
  { v: "daily", label: "Daily life" },
  { v: "unsure", label: "Not sure" },
];

export const FEELS: { v: Feel; label: string }[] = [
  { v: "sore", label: "Sore" },
  { v: "tight", label: "Tight" },
  { v: "ache", label: "Dull" },
  { v: "sharp", label: "Sharp" },
  { v: "burning", label: "Burning" },
  { v: "numb", label: "Tingling or numb" },
  { v: "pinch", label: "Pinching" },
  { v: "swollen", label: "Swollen" },
  { v: "pop", label: "Felt a pop" },
  { v: "other", label: "Something else" },
  { v: "fatigued", label: "Heavy or tired" },
  { v: "cramp", label: "Cramping" },
  { v: "weak", label: "Weak" },
  { v: "pressure", label: "Pressure" },
  { v: "throbbing", label: "Throbbing" },
  { v: "sudden", label: "Came on suddenly" },
];

/** What the review offers for "What does it feel like?" (pinching stays readable from older reports). */
export const FEEL_CHOICES: Feel[] = ["sore", "tight", "fatigued", "ache", "sharp", "burning", "numb", "cramp", "other"];
/** What it offers for a headache or a face (no muscle there to be tight or tired). */
export const HEAD_FEEL_CHOICES: Feel[] = ["ache", "pressure", "throbbing", "sharp", "numb", "other"];
/** Asked apart: they matter for safety (safety.ts), not for describing the pain. */
export const FEEL_SIGNS: Feel[] = ["swollen", "pop", "weak"];
/** A headache's own sign: one that came on suddenly and severely needs help now. */
export const HEAD_SIGNS: Feel[] = ["sudden", "weak"];

export const TIMINGS: { v: Timing; label: string }[] = [
  { v: "during", label: "During exercise" },
  { v: "after", label: "After training" },
  { v: "rest", label: "At rest" },
  { v: "movement", label: "Certain movements" },
];

/** 0–10, the way the review asks it. */
export const SCORE_MAX = 10;

/** The words under the number: what a 0–10 means, the same bands as Mild / Moderate / Severe. */
export function scoreWord(score: number | null | undefined): string | null {
  if (score == null) return null;
  if (score <= 0) return "None right now";
  if (score <= 3) return "Mild";
  if (score <= 6) return "Moderate";
  if (score <= 9) return "Severe";
  return "Worst it gets";
}

/** A 0–10 score as the stored severity band (0–3 mild, 4–6 moderate, 7–10 severe). */
export function severityFromScore(score: number): Severity {
  return score <= 3 ? "mild" : score <= 6 ? "moderate" : "severe";
}

export const IMPACTS: { v: Impact; label: string }[] = [
  { v: "none", label: "No" },
  { v: "modified", label: "Changed it" },
  { v: "stopped", label: "Had to stop" },
];

export const CHANGES: { v: Change; label: string }[] = [
  { v: "better", label: "Better" },
  { v: "same", label: "Same" },
  { v: "worse", label: "Worse" },
];

export const NOTE_MAX = 300;
/** Places in one review (several spots in one region each count). */
export const MAX_AREAS = 16;

/** What the review sends for one place. */
export type PainReportInput = {
  region: string;
  side: PainSide | null;
  /** The exact spot on the body map (sites.ts), or null for the region in general. */
  site?: string | null;
  /** Null with no score: they said they're not sure how bad (Nov 26 2026), or a kind that needs no rating (symptoms.ts) that wasn't rated. */
  severity: Severity | null;
  /** 0–10 (the review from Nov 21 2026); older reports have only the severity. */
  score?: number | null;
  timing?: Timing[];
  trigger?: Trigger | null;
  exerciseId?: string | null;
  exerciseName?: string | null;
  feel?: Feel[];
  impact?: Impact | null;
  /** The athlete's answer to "Same as <date>?": true = the same issue, false = something new, null = not asked or skipped. */
  sameIssue?: boolean | null;
  change?: Change | null;
  /** The earlier report they said it's the same as. */
  continuesId?: string | null;
  note?: string | null;
  /** A general symptom (symptoms.ts): a headache in the head, dizziness or nausea in no one place. */
  symptom?: GeneralSymptom | null;
};

const REGION_SET = new Set(PAIN_REGIONS.map((r) => r.key));

export const painReportSchema = z.object({
  region: z.string().refine((r) => REGION_SET.has(r), "Unknown body area"),
  side: z.enum(["L", "R"]).nullable(),
  site: z.string().max(40).refine((s) => SITE_KEYS.has(s), "Unknown spot").nullable().optional(),
  // null: "not sure how bad", or a kind that needs no rating (soreness, tightness, fatigue, a general symptom) that wasn't rated; an older app always sends one
  severity: z.enum(["mild", "moderate", "severe"]).nullable(),
  score: z.number().int().min(0).max(SCORE_MAX).nullable().optional(),
  timing: z.array(z.enum(["during", "after", "rest", "movement"])).max(4).optional(),
  trigger: z.enum(["training", "exercise", "daily", "unsure"]).nullable().optional(),
  exerciseId: z.string().uuid().nullable().optional(),
  exerciseName: z.string().max(120).nullable().optional(),
  feel: z.array(z.enum(FEEL_KEYS as [Feel, ...Feel[]])).max(16).optional(),
  impact: z.enum(["none", "modified", "stopped"]).nullable().optional(),
  sameIssue: z.boolean().nullable().optional(),
  change: z.enum(["better", "same", "worse"]).nullable().optional(),
  continuesId: z.string().uuid().nullable().optional(),
  note: z.string().max(NOTE_MAX).nullable().optional(),
  symptom: z.enum(GENERAL_SYMPTOM_KEYS).nullable().optional(),
});

export const painReportsSchema = z.array(painReportSchema).max(MAX_AREAS);

export function severityLevel(s: Severity): number {
  return SEVERITIES.find((x) => x.v === s)?.level ?? 5;
}

/** What a place says when they weren't sure how bad (never a number standing in for one). */
export const UNSURE_WORDS = "Not sure how bad";

/** A stored 1–10 level as a word (the review stored 3 / 5 / 8; anything older reads by band). */
export function severityOf(level: number | null | undefined): Severity | null {
  if (level == null) return null;
  return level <= 3 ? "mild" : level <= 6 ? "moderate" : "severe";
}

export function severityLabel(s: Severity | null | undefined): string | null {
  return s ? SEVERITIES.find((x) => x.v === s)?.label ?? null : null;
}

const RANK: Record<Severity, number> = { mild: 1, moderate: 2, severe: 3 };
export function severityRank(s: Severity | null | undefined): number {
  return s ? RANK[s] : 0;
}

/** The worst place, for the review's one pain_level (a place with no rating counts as none). */
export function worstSeverity(reports: Pick<PainReportInput, "severity">[]): Severity | null {
  let worst: Severity | null = null;
  for (const r of reports) if (severityRank(r.severity) > severityRank(worst)) worst = r.severity;
  return worst;
}

/**
 * Tidy what the sheet built before it's sent: one entry per place (a region,
 * its side and its spot; the last wins), a note trimmed, the severity from the
 * 0–10 when there is one, what set it off read from when it hurts (an exercise
 * named = the exercise; during or after training = training; only at rest =
 * daily life), the exercise only when it set it off, a change only when they
 * said it's the same issue, nothing for a place that isn't one.
 */
export function cleanReports(reports: PainReportInput[]): PainReportInput[] {
  const byPlace = new Map<string, PainReportInput>();
  for (const r of reports) {
    const region = regionOf(r.region);
    if (!region) continue;
    // a general symptom lives where it's drawn: a headache in the head, the rest nowhere
    const gen = generalOf(r.symptom);
    if (gen && !(gen.region === r.region || (gen.key === "headache" && (r.region === "face" || r.region === "general")))) continue;
    if (r.region === "general" && !gen) continue;
    const s = siteOf(r.site);
    const site = s && s.region === r.region ? s.key : null;
    const side = site && s?.midline ? null : r.side === "L" || r.side === "R" ? r.side : null;
    const note = (r.note ?? "").trim().slice(0, NOTE_MAX) || null;
    const score = typeof r.score === "number" && Number.isFinite(r.score) ? Math.max(0, Math.min(SCORE_MAX, Math.round(r.score))) : null;
    const timing = [...new Set((r.timing ?? []).filter((t) => TIMINGS.some((x) => x.v === t)))];
    const named = (r.exerciseName ?? "").trim().slice(0, 120) || null;
    const training = timing.some((t) => t === "during" || t === "after" || t === "movement");
    const trigger: Trigger | null = timing.length
      ? named && training ? "exercise" : training ? "training" : "daily"
      : r.trigger ?? null;
    const exercise = trigger === "exercise";
    const same = r.sameIssue ?? null;
    byPlace.set(`${r.region}:${side ?? ""}:${site ?? ""}:${gen?.key ?? ""}`, {
      region: r.region,
      side,
      site,
      symptom: gen?.key ?? null,
      severity: score != null ? severityFromScore(score) : r.severity ?? null,
      score,
      timing,
      trigger,
      exerciseId: exercise ? r.exerciseId ?? null : null,
      exerciseName: exercise ? named : null,
      feel: [...new Set(r.feel ?? [])],
      impact: r.impact ?? null,
      sameIssue: same,
      change: same === true ? r.change ?? null : null,
      continuesId: same === true ? r.continuesId ?? null : null,
      note,
    });
  }
  return [...byPlace.values()];
}

/** The review's legacy columns from the structured places: pain_area text and pain_level. */
export function legacyColumns(reports: PainReportInput[]): { painArea: string | null; painLevel: number | null } {
  // the worst place: its 0–10 when it has one, else its band's level (the column is 1–10, so a "none right now" is 1);
  // a place they weren't sure about has none, and with no rated place the review has none either
  const levels = reports.flatMap((r) => (typeof r.score === "number" ? [r.score] : r.severity ? [severityLevel(r.severity)] : []));
  const level = levels.length ? Math.max(1, ...levels) : null;
  const places = reports.filter((r) => !generalOf(r.symptom));
  const symptoms = [...new Set(reports.map((r) => generalLabel(r.symptom)).filter((x): x is string => !!x))];
  const area = [legacyAreaText(places.map((r) => ({ region: r.region, side: r.side, note: r.note }))), ...symptoms].filter(Boolean).join(", ");
  return {
    painArea: area || null,
    painLevel: level,
  };
}

/** The place in words: the spot when there is one ("Left side delt"), else the region ("Left shoulder"). */
export function placeLabel(r: { region: string; side: PainSide | null; site?: string | null; note?: string | null; symptom?: string | null }): string {
  const gen = generalOf(r.symptom);
  if (gen) {
    // "Headache (behind the left eye)" when they said where; else just the symptom
    if (gen.region === "head" && (r.site || r.side || r.region === "face")) return `${gen.label} (${(r.site && siteOf(r.site) ? siteLabel(r.site, r.side) : areaLabel(r.region, r.side)).toLowerCase()})`;
    return gen.label;
  }
  if (r.region === "general") return "Whole body";
  if (r.region === "other" && r.note) return r.note.slice(0, 60);
  if (r.site && siteOf(r.site)) return siteLabel(r.site, r.side);
  return areaLabel(r.region, r.side);
}

/** "Left side delt · 6/10 · bench press" (or "· moderate" for an older report): one line per place for cards and the coach. */
export function reportLine(r: { region: string; side: PainSide | null; site?: string | null; severity: Severity | null; score?: number | null; exerciseName?: string | null; note?: string | null; symptom?: string | null }): string {
  const how = r.score != null ? `${r.score}/10` : severityLabel(r.severity)?.toLowerCase();
  return [placeLabel(r), how, r.exerciseName].filter(Boolean).join(" · ");
}

/** Regions the database took before the whole body (20270603090000). */
const OLDER_REGIONS = new Set(["neck", "shoulder", "chest", "upper_arm", "elbow", "wrist_hand", "upper_back", "shoulder_blade", "mid_back", "low_back", "abs", "hip_groin", "glute", "quad", "hamstring", "knee", "shin", "calf", "ankle_foot", "other"]);

/**
 * The reports a database without the whole-body migration can store: its
 * regions only, rated, no general symptom. Used only when a save is refused
 * by that database's checks; everything else stays in pain_area's text.
 */
export function reportsForOlderSchema(reports: PainReportInput[]): PainReportInput[] {
  return reports.filter((r) => OLDER_REGIONS.has(r.region) && !r.symptom && !!r.severity).map((r) => ({ ...r, symptom: null }));
}
