/**
 * Program Intelligence as a PDF for reading (Nov 22 2026), drawn with the JF
 * Effect PDF kit: the findings (fact, hypothesis or missing, with their
 * evidence), the measured tables and the full prescribed-vs-actual log.
 * Landscape: its tables need the width (`orientationFor`). Every number is the
 * engine's (`buildIntelReport`); nothing is worked out here. Loaded on demand
 * (jsPDF is large), never in the page's own bundle.
 */
import { orientationFor, PdfDoc, PDF_COLOR, type Tone } from "@/lib/pdf/kit";
import { pdfDate, pdfText } from "@/lib/pdf/text";
import { deliverPdf, loadPdfLogo } from "@/lib/pdf/deliver";
import { BRAIN_SUMMARY } from "./brains";
import { fmtLoad, fmtSet } from "./core";
import { actualText, exportFileName, prescriptionText } from "./export";
import { BRAIN_LABEL, LIFTS, type Finding, type IntelRecords, type IntelReport } from "./types";

const KIND_LABEL: Record<Finding["kind"], string> = { fact: "Fact", hypothesis: "Hypothesis", missing: "Missing" };
const KIND_TONE: Record<Finding["kind"], Tone> = { fact: "neutral", hypothesis: "warn", missing: "muted" };
const AREA: Array<[Finding["area"], string]> = [
  ["improved", "What improved"],
  ["stalled", "What stalled or went backwards"],
  ["change", "What may need changing"],
  ["next", "For programming the next cycle"],
  ["missing", "Missing or incomplete information"],
];

const range = (a: string | null | undefined, b: string | null | undefined) => (a || b ? `${a ? pdfDate(a) : "?"} to ${b ? pdfDate(b) : "?"}` : "–");

export function buildIntelPdf(report: IntelReport, _rec: IntelRecords, meta: { privacySafe: boolean; reportId?: string | null; logo?: string | null }): PdfDoc {
  const u = report.client.unit;
  const kg = (n: number | null | undefined) => (n == null ? "–" : fmtLoad(n, u));
  const name = meta.privacySafe ? null : report.client.name;
  const c = report.coverage;
  // the weekly table is the widest: ~11 columns at their narrowest readable width
  const orientation = orientationFor([60, 110, 50, 60, 46, 46, 56, ...LIFTS.map(() => 52)]);
  const pdf = new PdfDoc({
    kind: "Program Intelligence",
    title: report.scope.label,
    subtitle: `Training ${range(c.firstDate, c.lastDate)}`,
    person: name,
    logo: meta.logo,
    orientation,
    facts: [
      ["Athlete", name ?? "Privacy-safe copy"],
      ["Brain", `${BRAIN_LABEL[report.brain]} (${report.brainSource === "override" ? "chosen by the coach" : "read from the data"})`],
      ["Generated", pdfDate(report.generatedAt)],
      ["Data", `${report.dataHash}${meta.reportId ? ` · export ${meta.reportId}` : ""}`],
    ],
  });

  pdf.paragraph(BRAIN_SUMMARY[report.brain], { size: 9.25 });
  pdf.paragraph("Fact: measured from the records, with the evidence named. Hypothesis: an interpretation, not a proven response. Missing: what the records can't tell.", { size: 8.5, color: PDF_COLOR.muted });

  pdf.heading("Data coverage", { keepWith: 70 });
  pdf.tiles(
    [
      { label: "Workouts due", value: String(c.dueDays) },
      { label: "Trained", value: String(c.completedDays + c.partialDays), sub: c.partialDays ? `${c.partialDays} partly` : null },
      { label: "Missed", value: String(c.missedDays), tone: c.missedDays ? "bad" : "neutral" },
      { label: "Sets done / due", value: `${c.completedSets}/${c.prescribedSetsDue}` },
      { label: "Sets with RPE", value: c.setsWithRpePct != null ? `${c.setsWithRpePct}%` : "–" },
      { label: "Check-outs", value: String(c.feedbackEntries) },
    ],
    { columns: 6 },
  );
  if (c.unmappedRows || c.unreadable.length) {
    pdf.paragraph(
      [c.unmappedRows ? `${c.unmappedRows} prescribed exercise${c.unmappedRows === 1 ? " isn't" : "s aren't"} in the library.` : null, c.unreadable.length ? `Couldn't read: ${c.unreadable.join(", ")}.` : null].filter(Boolean).join(" "),
      { size: 8.5, color: PDF_COLOR.warn },
    );
  }

  for (const [area, title] of AREA) {
    const list = report.findings.filter((f) => f.area === area);
    if (!list.length) continue;
    pdf.heading(title, { level: 2, keepWith: 50 });
    const notes = new Map<number, string>();
    list.forEach((f, i) => {
      if (f.evidence.length) notes.set(i, `Evidence: ${f.evidence.join(" · ")}`);
    });
    pdf.table({
      columns: [
        { header: "", width: 70 },
        { header: "Finding", width: "auto" },
      ],
      rows: list.map((f) => [KIND_LABEL[f.kind], `${pdfText(f.title)}. ${pdfText(f.detail)}`]),
      notes,
      hideHeader: true,
      cellTone: (r, col) => (col === 0 ? KIND_TONE[list[r].kind] : null),
      dense: true,
    });
  }

  pdf.heading("Competition lifts", { keepWith: 70 });
  pdf.table({
    dense: true,
    columns: [
      { header: "Lift", width: "auto", bold: true },
      { header: "e1RM first to last", width: "fit", max: 150 },
      { header: "Change", width: "fit", align: "right" },
      { header: "Peak", width: "fit", align: "right" },
      { header: "Freq/wk", width: "fit", align: "right" },
      { header: "Sets/wk", width: "fit", align: "right" },
      { header: "Avg % e1RM", width: "fit", align: "right" },
      { header: "RPE vs target", width: "fit", align: "right" },
      { header: "Heavy singles", width: "fit", align: "right" },
      { header: "Stalled", width: "fit" },
    ],
    rows: report.lifts.map((l) => [l.lift.charAt(0).toUpperCase() + l.lift.slice(1), l.compTrend.first == null && l.compTrend.last == null ? null : `${kg(l.compTrend.first)} to ${kg(l.compTrend.last)}`, l.compTrend.changePct != null ? `${l.compTrend.changePct}%` : null, kg(l.compTrend.peak), l.frequencyPerWeek as never, l.setsPerWeek as never, l.avgRelativeIntensityPct as never, l.avgRpeDelta as never, l.heavySingles as never, l.stalled ? "Yes" : ""]),
    cellTone: (r, col) => (col === 9 && report.lifts[r].stalled ? "warn" : null),
  });

  pdf.heading("Weekly training", { keepWith: 70 });
  pdf.table({
    dense: true,
    keepTogether: false,
    columns: [
      { header: "Week", width: "fit", bold: true },
      { header: "Dates", width: "fit", muted: true },
      { header: "Sessions", width: "fit", align: "center" },
      { header: "Sets logged / due", width: "fit", align: "center" },
      { header: "Hard sets", width: "fit", align: "right" },
      { header: "Avg RPE", width: "fit", align: "right" },
      { header: "RPE vs target", width: "fit", align: "right" },
      ...LIFTS.map((l) => ({ header: `${l} sets`, width: "fit" as const, align: "right" as const })),
    ],
    rows: report.weeks.map((w) => [w.label, range(w.start, w.end), `${w.completedDays + w.partialDays}/${w.dueDays}`, `${w.workingSetsLogged}/${w.prescribedSetsDue}`, w.hardSets as never, w.avgRpe as never, w.avgRpeDelta as never, ...LIFTS.map((l) => w.lifts[l].sets as never)]),
  });

  pdf.heading("Hard sets per muscle group", { keepWith: 70 });
  pdf.table({
    dense: true,
    keepTogether: false,
    columns: [
      { header: "Muscle", width: "fit", bold: true },
      { header: "Avg sets/week", width: "fit", align: "right" },
      { header: "First half to second", width: "fit", align: "right" },
      { header: "Freq/week", width: "fit", align: "right" },
      { header: "Exercises", width: "auto", muted: true },
    ],
    rows: report.muscles.map((m) => [m.muscle, m.avgHardSetsPerWeek as never, `${m.firstHalfAvg ?? "–"} to ${m.secondHalfAvg ?? "–"}`, m.frequencyPerWeek as never, m.exercises.slice(0, 6).join(", ")]),
  });

  pdf.heading("Blocks", { keepWith: 60 });
  pdf.table({
    dense: true,
    columns: [
      { header: "Block", width: "auto", bold: true },
      { header: "Dates", width: "fit", muted: true },
      { header: "Sessions", width: "fit", align: "right" },
      { header: "Sets", width: "fit", align: "right" },
      { header: "Hard sets/wk", width: "fit", align: "right" },
      { header: "Avg RPE", width: "fit", align: "right" },
      ...LIFTS.map((l) => ({ header: `${l} e1RM`, width: "fit" as const, align: "right" as const })),
    ],
    rows: report.blocks.map((b) => [`B${b.number} ${b.name}`, range(b.start, b.end), b.sessionAdherencePct != null ? `${b.sessionAdherencePct}%` : null, b.setAdherencePct != null ? `${b.setAdherencePct}%` : null, b.avgHardSetsPerWeek as never, b.avgRpe as never, ...LIFTS.map((l) => (b.liftChange[l].changePct != null ? `${b.liftChange[l].changePct}%` : null))]),
  });

  pdf.heading("Exercises", { keepWith: 60 });
  pdf.table({
    dense: true,
    keepTogether: false,
    columns: [
      { header: "Exercise", width: "auto", bold: true },
      { header: "Exposures", width: "fit", align: "right" },
      { header: "Sets logged / due", width: "fit", align: "center" },
      { header: "e1RM first to last", width: "fit", max: 170 },
      { header: "Best set", width: "fit", max: 130 },
      { header: "Avg RPE", width: "fit", align: "right" },
      { header: "Stalled", width: "fit" },
    ],
    rows: report.exercises.map((e) => [e.name, e.exposures as never, `${e.workingSetsLogged}/${e.setsPrescribedDue}`, e.trend.first != null ? `${kg(e.trend.first)} to ${kg(e.trend.last)}` : e.repsTrend ? `reps ${e.repsTrend.first} to ${e.repsTrend.last}` : null, fmtSet(e.bestSet, u), e.avgRpe as never, e.stalled ? "Yes" : ""]),
    cellTone: (r, col) => (col === 6 && report.exercises[r].stalled ? "warn" : null),
  });

  pdf.heading("Full training log: prescribed against actual", { newPage: true });
  const weekOf = new Map(report.weeks.map((w) => [w.key, w]));
  pdf.table({
    dense: true,
    keepTogether: false,
    columns: [
      { header: "Week", width: "fit", bold: true },
      { header: "Date", width: "fit", muted: true },
      { header: "Day", width: "fit", max: 120 },
      { header: "Status", width: "fit", max: 110 },
      { header: "Exercise", width: "fit", max: 160, bold: true },
      { header: "Prescribed", width: "fit", max: 150 },
      { header: "Actual (logged sets)", width: "auto" },
    ],
    rows: report.days.flatMap((d) =>
      d.rows.length
        ? d.rows.map((r) => [weekOf.get(d.weekKey)?.label ?? null, d.date ? pdfDate(d.date, { year: "auto" }) : null, `${d.dayIndex} ${d.title}`, `${d.status} / ${r.status}`, r.exercise, prescriptionText(r.prescribed, u), actualText(r.actual, u)])
        : [[weekOf.get(d.weekKey)?.label ?? null, d.date ? pdfDate(d.date, { year: "auto" }) : null, `${d.dayIndex} ${d.title}`, d.status, null, null, null]],
    ),
  });
  return pdf;
}

/** Makes the PDF and hands it over (the share sheet on a phone, a download on a computer). */
export async function downloadIntelPdf(report: IntelReport, rec: IntelRecords, meta: { privacySafe: boolean; reportId?: string | null }) {
  const file = buildIntelPdf(report, rec, { ...meta, logo: await loadPdfLogo() }).toFile(exportFileName(report, "pdf", meta.privacySafe));
  await deliverPdf(file, "Program Intelligence");
}
