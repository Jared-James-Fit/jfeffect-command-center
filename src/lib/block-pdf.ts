import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";
import type { BlockAnalytics } from "./block-analytics";

function formatGeneratedDate(d: Date): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `Generated ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Generate a PDF summary of a block's analytics and trigger a download. */
export function exportBlockPDF(a: BlockAnalytics): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  let y = margin;

  // Brand header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text("JF Effect", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(formatGeneratedDate(new Date()), margin, y);
  y += 16;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(a.block.name ?? "Training Block", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  const subtitleParts: string[] = [];
  if (a.block.start_date) subtitleParts.push(`Start ${a.block.start_date}`);
  if (a.block.end_date) subtitleParts.push(`End ${a.block.end_date}`);
  if (a.block.status) subtitleParts.push(a.block.status);
  doc.text(subtitleParts.join("  ·  "), margin, y);
  y += 18;
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: [
      ["Workouts Completed", `${a.summary.workouts_completed}/${a.summary.total_workouts}`],
      ["Completion %", `${a.summary.completion_pct}%`],
      ["Sets Completed", `${a.summary.sets_completed}/${a.summary.total_sets}`],
      ["Total Volume", `${a.summary.total_volume.toLocaleString()} ${a.unit}`],
      ["Avg RPE", a.summary.avg_rpe?.toString() ?? "—"],
      ["Missed Workouts", String(a.summary.missed_workouts)],
      ["Manual Weeks", String(a.summary.manual_weeks)],
      ["Training Minutes", String(a.summary.total_training_min)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: margin, right: margin },
  });

  if (a.weekly.length) {
    autoTable(doc, {
      head: [["Week", "Volume", "Workouts", "Avg RPE", "Top Set", "e1RM", "Completion %"]],
      body: a.weekly.map((w) => [
        `W${w.week_index}`,
        w.volume.toLocaleString(),
        `${w.workouts_completed}/${w.workouts_total}`,
        w.avg_rpe ?? "—",
        w.top_set ?? "—",
        w.est_1rm ?? "—",
        `${w.completion_pct}%`,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: margin, right: margin },
    });
  }

  if (a.prs.length) {
    autoTable(doc, {
      head: [["PR", "Value", "Exercise", "Date"]],
      body: a.prs.map((pr) => [
        pr.label,
        pr.value,
        pr.exercise,
        pr.date ? format(parseISO(pr.date), "MMM d, yyyy") : "—",
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: margin, right: margin },
    });
  }

  if (a.insights.length) {
    autoTable(doc, {
      head: [["Insight", "Value"]],
      body: a.insights.map((i) => [i.label, i.value]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: margin, right: margin },
    });
  }

  if (a.flags.length) {
    autoTable(doc, {
      head: [["Flag"]],
      body: a.flags.map((f) => [f.label]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: margin, right: margin },
    });
  }

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerText = "Generated from JF Effect Client Portal";
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(128);
    const w = doc.getTextWidth(footerText);
    doc.text(footerText, (pageWidth - w) / 2, pageHeight - 16);
    doc.setTextColor(0);
  }

  doc.save(`${(a.block.name ?? "block").replace(/\s+/g, "-")}-summary.pdf`);
}