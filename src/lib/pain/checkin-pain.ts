/**
 * The weekly check-in's typed "where does it hurt" as structured reports
 * (pure, tested; Nov 26 2026). The check-in stays one text question; on
 * submit its words go through the same reader as the review's voice
 * (describe.ts), so a knee, a headache or numb fingers in a check-in land in
 * the same history, recovery read, coach sheet and Cleo context as one
 * reported after a workout. Only what their words say is kept (a place the
 * reader can't name stays in the text, which the history still reads), never
 * a guessed score or side.
 */
import { describePain } from "@/lib/pain/describe";
import { cleanReports, severityFromScore, type PainReportInput } from "@/lib/pain/report";

export function checkinPainReports(text: string | null | undefined): PainReportInput[] {
  const t = (text ?? "").trim();
  if (t.length < 3) return [];
  const read = describePain(t);
  return cleanReports(
    read.places.map((p) => ({
      region: p.region,
      side: p.side,
      site: p.site,
      symptom: p.symptom ?? null,
      score: p.score,
      severity: p.score != null ? severityFromScore(p.score) : null,
      timing: p.timing,
      feel: p.feel,
      impact: p.impact,
      exerciseName: p.exerciseName,
      exerciseId: null,
      note: p.note || t.slice(0, 300),
    })),
  );
}
