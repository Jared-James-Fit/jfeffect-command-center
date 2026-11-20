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

export type Severity = "mild" | "moderate" | "severe";
export type Trigger = "training" | "exercise" | "daily" | "unsure";
export type Impact = "none" | "modified" | "stopped";
export type Change = "better" | "same" | "worse";
export type Feel = "sore" | "tight" | "ache" | "sharp" | "pinch" | "numb" | "swollen" | "pop";

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
  { v: "ache", label: "Dull ache" },
  { v: "sharp", label: "Sharp" },
  { v: "pinch", label: "Pinching" },
  { v: "numb", label: "Numb / tingling" },
  { v: "swollen", label: "Swollen" },
  { v: "pop", label: "Felt a pop" },
];

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
export const MAX_AREAS = 12;

/** What the review sends for one place. */
export type PainReportInput = {
  region: string;
  side: PainSide | null;
  severity: Severity;
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
  severity: z.enum(["mild", "moderate", "severe"]),
  trigger: z.enum(["training", "exercise", "daily", "unsure"]).nullable().optional(),
  exerciseId: z.string().uuid().nullable().optional(),
  exerciseName: z.string().max(120).nullable().optional(),
  feel: z.array(z.enum(["sore", "tight", "ache", "sharp", "pinch", "numb", "swollen", "pop"])).max(8).optional(),
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
 * Tidy what the sheet built before it's sent: one entry per place (the last
 * wins), a note trimmed, the exercise only when the trigger is an exercise,
 * a change only when they said it's the same issue, nothing for a place that
 * isn't one.
 */
export function cleanReports(reports: PainReportInput[]): PainReportInput[] {
  const byPlace = new Map<string, PainReportInput>();
  for (const r of reports) {
    const region = regionOf(r.region);
    if (!region) continue;
    const side = r.side === "L" || r.side === "R" ? r.side : null;
    const note = (r.note ?? "").trim().slice(0, NOTE_MAX) || null;
    const exercise = r.trigger === "exercise";
    const same = r.sameIssue ?? null;
    byPlace.set(`${r.region}:${side ?? ""}`, {
      region: r.region,
      side,
      severity: r.severity,
      trigger: r.trigger ?? null,
      exerciseId: exercise ? r.exerciseId ?? null : null,
      exerciseName: exercise ? (r.exerciseName ?? "").trim().slice(0, 120) || null : null,
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
  const worst = worstSeverity(reports);
  return {
    painArea: legacyAreaText(reports.map((r) => ({ region: r.region, side: r.side, note: r.note }))),
    painLevel: worst ? severityLevel(worst) : null,
  };
}

/** "Left shoulder · moderate · bench press" — one line per place for cards and the coach. */
export function reportLine(r: { region: string; side: PainSide | null; severity: Severity | null; exerciseName?: string | null; note?: string | null }): string {
  const place = r.region === "other" && r.note ? r.note.slice(0, 60) : areaLabel(r.region, r.side);
  return [place, severityLabel(r.severity)?.toLowerCase(), r.exerciseName].filter(Boolean).join(" · ");
}
