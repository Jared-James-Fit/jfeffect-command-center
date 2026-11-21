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

export type Severity = "mild" | "moderate" | "severe";
export type Trigger = "training" | "exercise" | "daily" | "unsure";
export type Impact = "none" | "modified" | "stopped";
export type Change = "better" | "same" | "worse";
export type Feel = "sore" | "tight" | "ache" | "sharp" | "pinch" | "numb" | "swollen" | "pop" | "burning" | "other";
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
];

/** What the review offers for "What does it feel like?" (pinching stays readable from older reports). */
export const FEEL_CHOICES: Feel[] = ["sore", "tight", "ache", "sharp", "burning", "numb", "other"];
/** Asked apart: they matter for safety (safety.ts), not for describing the pain. */
export const FEEL_SIGNS: Feel[] = ["swollen", "pop"];

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
  severity: Severity;
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
};

const REGION_SET = new Set(PAIN_REGIONS.map((r) => r.key));

export const painReportSchema = z.object({
  region: z.string().refine((r) => REGION_SET.has(r), "Unknown body area"),
  side: z.enum(["L", "R"]).nullable(),
  site: z.string().max(40).refine((s) => SITE_KEYS.has(s), "Unknown spot").nullable().optional(),
  severity: z.enum(["mild", "moderate", "severe"]),
  score: z.number().int().min(0).max(SCORE_MAX).nullable().optional(),
  timing: z.array(z.enum(["during", "after", "rest", "movement"])).max(4).optional(),
  trigger: z.enum(["training", "exercise", "daily", "unsure"]).nullable().optional(),
  exerciseId: z.string().uuid().nullable().optional(),
  exerciseName: z.string().max(120).nullable().optional(),
  feel: z.array(z.enum(["sore", "tight", "ache", "sharp", "pinch", "numb", "swollen", "pop", "burning", "other"])).max(10).optional(),
  impact: z.enum(["none", "modified", "stopped"]).nullable().optional(),
  sameIssue: z.boolean().nullable().optional(),
  change: z.enum(["better", "same", "worse"]).nullable().optional(),
  continuesId: z.string().uuid().nullable().optional(),
  note: z.string().max(NOTE_MAX).nullable().optional(),
});

export const painReportsSchema = z.array(painReportSchema).max(MAX_AREAS);

export function severityLevel(s: Severity): number {
  return SEVERITIES.find((x) => x.v === s)?.level ?? 5;
}

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

/** The worst place, for the review's one pain_level. */
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
    byPlace.set(`${r.region}:${side ?? ""}:${site ?? ""}`, {
      region: r.region,
      side,
      site,
      severity: score != null ? severityFromScore(score) : r.severity,
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
  // the worst place: its 0–10 when it has one, else its band's level (the column is 1–10, so a "none right now" is 1)
  const levels = reports.map((r) => (typeof r.score === "number" ? r.score : severityLevel(r.severity)));
  const level = levels.length ? Math.max(1, ...levels) : null;
  return {
    painArea: legacyAreaText(reports.map((r) => ({ region: r.region, side: r.side, note: r.note }))),
    painLevel: level,
  };
}

/** The place in words: the spot when there is one ("Left side delt"), else the region ("Left shoulder"). */
export function placeLabel(r: { region: string; side: PainSide | null; site?: string | null; note?: string | null }): string {
  if (r.region === "other" && r.note) return r.note.slice(0, 60);
  if (r.site && siteOf(r.site)) return siteLabel(r.site, r.side);
  return areaLabel(r.region, r.side);
}

/** "Left side delt · 6/10 · bench press" (or "· moderate" for an older report): one line per place for cards and the coach. */
export function reportLine(r: { region: string; side: PainSide | null; site?: string | null; severity: Severity | null; score?: number | null; exerciseName?: string | null; note?: string | null }): string {
  const how = r.score != null ? `${r.score}/10` : severityLabel(r.severity)?.toLowerCase();
  return [placeLabel(r), how, r.exerciseName].filter(Boolean).join(" · ");
}
