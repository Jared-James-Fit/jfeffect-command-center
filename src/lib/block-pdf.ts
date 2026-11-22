/**
 * The block review PDF (Nov 22 2026), drawn with the JF Effect PDF kit: the
 * end-of-block read the coach sees in Block Progress, as a document. Every
 * number is `computeBlockAnalytics`'s (block-analytics.ts), the same the card
 * shows; the charts are drawn from the weekly rows printed beside them.
 */
import { format, parseISO } from "date-fns";
import { PdfDoc, PDF_COLOR } from "@/lib/pdf/kit";
import { chartRow, drawBarChart } from "@/lib/pdf/charts";
import { pdfFileName, pdfNumber, pdfRange, pdfText } from "@/lib/pdf/text";
import { deliverPdf, loadPdfLogo } from "@/lib/pdf/deliver";
import type { BlockAnalytics } from "./block-analytics";

export function buildBlockPdf(a: BlockAnalytics, opts: { logo?: string | null; clientName?: string | null; generatedAt?: Date } = {}): PdfDoc {
  const s = a.summary;
  const u = a.unit;
  const pdf = new PdfDoc({
    kind: "Block review",
    title: pdfText(a.block?.name) || "Training block",
    subtitle: pdfRange(a.block?.start_date ?? null, a.block?.end_date ?? null) || null,
    person: opts.clientName ?? null,
    logo: opts.logo,
    generatedAt: opts.generatedAt,
    facts: [
      ["Athlete", opts.clientName ?? null],
      ["Status", pdfText(a.block?.status) || null],
      ["Weeks", a.weekly.length ? String(a.weekly.length) : null],
    ],
  });

  pdf.heading("Summary", { keepWith: 80 });
  pdf.tiles([
    { label: "Workouts done", value: `${s.workouts_completed}/${s.total_workouts}`, sub: `${s.completion_pct}% of the block`, tone: s.completion_pct >= 85 ? "good" : s.completion_pct >= 60 ? "neutral" : "warn" },
    { label: "Sets done", value: `${s.sets_completed}/${s.total_sets}` },
    { label: `Volume (${u})`, value: pdfNumber(s.total_volume, 0) },
    { label: "Average RPE", value: s.avg_rpe != null ? pdfNumber(s.avg_rpe, 1) : "–" },
    { label: "Missed workouts", value: String(s.missed_workouts), tone: s.missed_workouts ? "bad" : "neutral" },
    { label: "Training time", value: s.total_training_min ? `${pdfNumber(s.total_training_min, 0)} min` : "–" },
  ]);

  if (a.weekly.length >= 2) {
    chartRow(pdf, 150, [
      (doc, box) => drawBarChart(doc, box, { title: `Volume each week (${u})`, bars: a.weekly.map((w) => ({ label: `W${w.week_index}`, value: w.volume })), valueLabels: false }),
      (doc, box) => drawBarChart(doc, box, { title: "Workouts done each week", bars: a.weekly.map((w) => ({ label: `W${w.week_index}`, value: w.workouts_completed, target: w.workouts_total })), targetLabel: "Planned" }),
    ]);
  }

  if (a.weekly.length) {
    pdf.heading("Week by week", { level: 2, keepWith: 80 });
    pdf.table({
      columns: [
        { header: "Week", width: 44, bold: true },
        { header: `Volume (${u})`, width: "auto", align: "right" },
        { header: "Workouts", width: 62, align: "center" },
        { header: "Avg RPE", width: 52, align: "center" },
        { header: "Top set", width: 62, align: "right" },
        { header: "Best e1RM", width: 66, align: "right" },
        { header: "Done", width: 46, align: "right" },
      ],
      rows: a.weekly.map((w) => [
        `W${w.week_index}`,
        pdfNumber(w.volume, 0),
        `${w.workouts_completed}/${w.workouts_total}`,
        w.avg_rpe != null ? pdfNumber(w.avg_rpe, 1) : null,
        w.top_set != null ? `${pdfNumber(w.top_set, 1)} ${u}` : null,
        w.est_1rm != null ? `${pdfNumber(w.est_1rm, 1)} ${u}` : null,
        `${w.completion_pct}%`,
      ]),
      cellTone: (r, c) => (c === 6 ? (a.weekly[r].completion_pct >= 85 ? "good" : a.weekly[r].completion_pct < 60 ? "warn" : null) : null),
    });
  }

  if (a.prs.length) {
    pdf.heading("Records in this block", { level: 2, keepWith: 60 });
    pdf.table({
      columns: [
        { header: "Record", width: "fit", max: 140 },
        { header: "Exercise", width: "auto", bold: true },
        { header: "Set", width: "fit", max: 130, align: "right" },
        { header: "Date", width: 76, muted: true },
      ],
      rows: a.prs.map((p) => [pdfText(p.label), pdfText(p.exercise), pdfText(p.value), p.date ? format(parseISO(p.date), "MMM d, yyyy") : null]),
    });
  }

  if (a.insights.length || a.flags.length) {
    pdf.heading("What stands out", { level: 2, keepWith: 50 });
    if (a.insights.length) {
      pdf.table({
        columns: [
          { header: "", width: 170, muted: true },
          { header: "", width: "auto" },
        ],
        rows: a.insights.map((i) => [pdfText(i.label), pdfText(i.value)]),
        hideHeader: true,
      });
    }
    if (a.flags.length) pdf.bullets(a.flags.map((f) => f.label), { marker: PDF_COLOR.warn });
  }
  return pdf;
}

/** Makes the block review and hands it over (the share sheet on a phone, a download on a computer). */
export async function exportBlockPDF(a: BlockAnalytics, clientName?: string | null): Promise<void> {
  const file = buildBlockPdf(a, { logo: await loadPdfLogo(), clientName }).toFile(pdfFileName({ person: clientName, document: "block review", detail: a.block?.name ?? null }));
  await deliverPdf(file, "Block review");
}
