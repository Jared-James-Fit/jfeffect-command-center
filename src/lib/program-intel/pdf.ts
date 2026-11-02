/**
 * Program Intelligence as a PDF for reading: the findings, the measured
 * tables and the full prescribed-vs-actual log. Loaded on demand (jsPDF is
 * large), never in the page's own bundle.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { BRAIN_SUMMARY } from "./brains";
import { fmtLoad, fmtSet } from "./core";
import { actualText, exportFileName, prescriptionText } from "./export";
import { BRAIN_LABEL, LIFTS, type Finding, type IntelRecords, type IntelReport } from "./types";

const KIND: Record<Finding["kind"], string> = { fact: "FACT", hypothesis: "HYPOTHESIS", missing: "MISSING" };
const AREA: Array<[Finding["area"], string]> = [
  ["improved", "What improved"],
  ["stalled", "What stalled or went backwards"],
  ["change", "What may need changing"],
  ["next", "For programming the next cycle"],
  ["missing", "Missing or incomplete information"],
];

export function buildIntelPdf(report: IntelReport, rec: IntelRecords, meta: { privacySafe: boolean; reportId?: string | null }): jsPDF {
  const u = report.client.unit;
  const kg = (n: number | null | undefined) => (n == null ? "—" : fmtLoad(n, u));
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;
  const line = (text: string, size = 10, bold = false, color: [number, number, number] = [20, 20, 20]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const l of doc.splitTextToSize(text, W - M * 2) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - M) {
        doc.addPage();
        y = M;
      }
      doc.text(l, M, y);
      y += size * 1.35;
    }
  };
  const tableAt = (head: string[], body: unknown[][], fontSize = 7.5) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.map((r) => r.map((c) => (c == null ? "—" : String(c)))),
      margin: { left: M, right: M },
      styles: { fontSize, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [30, 30, 30] },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  };

  line(`Program Intelligence: ${report.client.name}`, 18, true);
  line(`${report.scope.label} · training ${report.coverage.firstDate ?? "—"} → ${report.coverage.lastDate ?? "—"}`, 10);
  line(`Brain: ${BRAIN_LABEL[report.brain]} (${report.brainSource === "override" ? "chosen by the coach" : "classified from the data"}) · generated ${report.generatedAt.slice(0, 16).replace("T", " ")} · data ${report.dataHash}${meta.reportId ? ` · export ${meta.reportId}` : ""}${meta.privacySafe ? " · privacy-safe" : ""}`, 8, false, [90, 90, 90]);
  y += 4;
  line(BRAIN_SUMMARY[report.brain], 9, false, [60, 60, 60]);
  line("FACT = measured from the records (named as evidence). HYPOTHESIS = an interpretation, not a proven response. MISSING = what the records can't tell.", 8, false, [90, 90, 90]);
  y += 6;

  const c = report.coverage;
  line("Data coverage", 12, true);
  tableAt(["Workouts due", "Trained", "Missed", "Upcoming", "Sets due", "Sets done", "RPE logged", "Check-outs", "Not in library", "Couldn't read"], [[c.dueDays, c.completedDays + c.partialDays, c.missedDays, c.upcomingDays, c.prescribedSetsDue, c.completedSets, c.setsWithRpePct != null ? `${c.setsWithRpePct}%` : "—", c.feedbackEntries, c.unmappedRows, c.unreadable.join(", ") || "nothing"]]);

  for (const [area, title] of AREA) {
    const list = report.findings.filter((f) => f.area === area);
    if (!list.length) continue;
    line(title, 12, true);
    for (const f of list) {
      line(`[${KIND[f.kind]}] ${f.title}. ${f.detail}`, 9, false, f.kind === "hypothesis" ? [120, 70, 0] : f.kind === "missing" ? [110, 110, 110] : [20, 20, 20]);
      for (const e of f.evidence) line(`   · ${e}`, 8, false, [90, 90, 90]);
    }
    y += 4;
  }

  line("Competition lifts", 12, true);
  tableAt(
    ["Lift", "e1RM first → last", "Change", "Peak", "Freq/wk", "Sets/wk", "Avg % e1RM", "RPE vs target", "Heavy singles", "Stalled"],
    report.lifts.map((l) => [l.lift, `${kg(l.compTrend.first)} → ${kg(l.compTrend.last)}`, l.compTrend.changePct != null ? `${l.compTrend.changePct}%` : "—", kg(l.compTrend.peak), l.frequencyPerWeek, l.setsPerWeek, l.avgRelativeIntensityPct, l.avgRpeDelta, l.heavySingles, l.stalled ? "yes" : ""]),
  );
  line("Weekly training", 12, true);
  tableAt(
    ["Week", "Dates", "Sessions", "Sets logged/due", "Hard sets", "Avg RPE", "RPE vs target", ...LIFTS.map((l) => `${l} sets`)],
    report.weeks.map((w) => [`${w.label}`, `${w.start ?? "?"} → ${w.end ?? "?"}`, `${w.completedDays + w.partialDays}/${w.dueDays}`, `${w.workingSetsLogged}/${w.prescribedSetsDue}`, w.hardSets, w.avgRpe, w.avgRpeDelta, ...LIFTS.map((l) => w.lifts[l].sets)]),
  );
  line("Hard sets per muscle group", 12, true);
  tableAt(["Muscle", "Avg sets/week", "First → second half", "Freq/week", "Exercises"], report.muscles.map((m) => [m.muscle, m.avgHardSetsPerWeek, `${m.firstHalfAvg ?? "—"} → ${m.secondHalfAvg ?? "—"}`, m.frequencyPerWeek, m.exercises.slice(0, 6).join(", ")]));
  line("Blocks", 12, true);
  tableAt(["Block", "Dates", "Sessions", "Sets", "Hard sets/wk", "Avg RPE", ...LIFTS.map((l) => `${l} e1RM`)], report.blocks.map((b) => [`B${b.number} ${b.name}`, `${b.start ?? "?"} → ${b.end ?? "?"}`, b.sessionAdherencePct != null ? `${b.sessionAdherencePct}%` : "—", b.setAdherencePct != null ? `${b.setAdherencePct}%` : "—", b.avgHardSetsPerWeek, b.avgRpe, ...LIFTS.map((l) => (b.liftChange[l].changePct != null ? `${b.liftChange[l].changePct}%` : "—"))]));
  line("Exercises", 12, true);
  tableAt(["Exercise", "Exposures", "Sets logged/due", "e1RM first → last", "Best set", "Avg RPE", "Stalled"], report.exercises.map((e) => [e.name, e.exposures, `${e.workingSetsLogged}/${e.setsPrescribedDue}`, e.trend.first != null ? `${kg(e.trend.first)} → ${kg(e.trend.last)}` : e.repsTrend ? `reps ${e.repsTrend.first} → ${e.repsTrend.last}` : "—", fmtSet(e.bestSet, u), e.avgRpe, e.stalled ? "yes" : ""]));

  doc.addPage();
  y = M;
  line("Full training log: prescribed vs actual", 14, true);
  const weekOf = new Map(report.weeks.map((w) => [w.key, w]));
  tableAt(
    ["Week", "Date", "Day", "Status", "Exercise", "Prescribed", "Actual (logged sets)"],
    report.days.flatMap((d) =>
      d.rows.length
        ? d.rows.map((r) => [weekOf.get(d.weekKey)?.label, d.date, `${d.dayIndex} ${d.title}`, `${d.status} / ${r.status}`, r.exercise, prescriptionText(r.prescribed, u), actualText(r.actual, u)])
        : [[weekOf.get(d.weekKey)?.label, d.date, `${d.dayIndex} ${d.title}`, d.status, "—", "—", "—"]],
    ),
    7,
  );
  void rec;
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(140, 140, 140);
    doc.text(`JF Effect · Program Intelligence · ${report.client.name} · page ${i} of ${pages}`, M, doc.internal.pageSize.getHeight() - 18);
  }
  return doc;
}

export function downloadIntelPdf(report: IntelReport, rec: IntelRecords, meta: { privacySafe: boolean; reportId?: string | null }) {
  buildIntelPdf(report, rec, meta).save(exportFileName(report, "pdf", meta.privacySafe));
}
