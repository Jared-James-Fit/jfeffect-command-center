import { jsPDF } from "jspdf";

type Day = {
  id?: string;
  day_label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  fibre?: number | null;
  notes?: string | null;
};

export type MealPlanPdfData = {
  client_name?: string | null;
  coach_name?: string | null;
  updated_at?: string | null;
  start_date?: string | null;
  phase?: string | null;
  goal?: string | null;
  structure?: string | null;
  water?: string | null;
  sleep?: string | null;
  client_notes?: string | null;
  disclaimer?: string | null;
  days: Day[];
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function generateMealPlanPdf(data: MealPlanPdfData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  let y = 48;

  // Header / brand bar
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, pageWidth, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("JF EFFECT", marginX, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Nutrition Plan", marginX, 54);

  doc.setTextColor(20, 20, 20);
  y = 100;

  // Meta block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(data.client_name || "Your Nutrition Plan", marginX, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const metaLines: string[] = [];
  const subtitle = [data.phase, data.goal, data.structure].filter(Boolean).join(" · ");
  if (subtitle) metaLines.push(subtitle);
  if (data.coach_name) metaLines.push(`Coach: ${data.coach_name}`);
  metaLines.push(`Assigned: ${fmtDate(data.start_date)}`);
  metaLines.push(`Last updated: ${fmtDate(data.updated_at)}`);
  for (const line of metaLines) {
    doc.text(line, marginX, y);
    y += 14;
  }
  y += 6;

  // Summary chips: water / sleep
  if (data.water || data.sleep) {
    doc.setDrawColor(220);
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(marginX, y, pageWidth - marginX * 2, 32, 6, 6, "F");
    doc.setTextColor(40, 40, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    let cx = marginX + 14;
    if (data.water) {
      doc.text(`Water: ${data.water}`, cx, y + 20);
      cx += 160;
    }
    if (data.sleep) {
      doc.text(`Sleep: ${data.sleep}`, cx, y + 20);
    }
    y += 44;
  }

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 60) {
      doc.addPage();
      y = 56;
    }
  };

  // Days
  for (const day of data.days) {
    ensureSpace(110);
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(day.day_label || "Day", marginX, y);
    y += 12;

    // Macros table
    const cellW = (pageWidth - marginX * 2) / 4;
    const macros: [string, number | null, string][] = [
      ["Calories", day.calories, ""],
      ["Protein", day.protein, "g"],
      ["Carbs", day.carbs, "g"],
      ["Fat", day.fats, "g"],
    ];
    doc.setDrawColor(220);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(marginX, y, pageWidth - marginX * 2, 44, 6, 6, "FD");
    macros.forEach(([label, val, unit], i) => {
      const cx = marginX + cellW * i + cellW / 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(20, 20, 20);
      const valueText = val == null ? "—" : `${val}${unit}`;
      doc.text(valueText, cx, y + 20, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(label.toUpperCase(), cx, y + 34, { align: "center" });
    });
    y += 56;

    if (day.notes && day.notes.trim()) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      const lines = doc.splitTextToSize(day.notes.trim(), pageWidth - marginX * 2);
      ensureSpace(lines.length * 12 + 6);
      doc.text(lines, marginX, y);
      y += lines.length * 12 + 8;
    }
    y += 6;
  }

  // Coach notes
  if (data.client_notes && data.client_notes.trim()) {
    ensureSpace(60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text("Coach Notes", marginX, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(data.client_notes.trim(), pageWidth - marginX * 2);
    ensureSpace(lines.length * 12);
    doc.text(lines, marginX, y);
    y += lines.length * 12 + 8;
  }

  // Disclaimer
  if (data.disclaimer && data.disclaimer.trim()) {
    ensureSpace(40);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    const lines = doc.splitTextToSize(data.disclaimer.trim(), pageWidth - marginX * 2);
    ensureSpace(lines.length * 11);
    doc.text(lines, marginX, y);
    y += lines.length * 11 + 6;
  }

  // Footer on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(
      "Generated from JF Effect Client Portal",
      marginX,
      pageHeight - 24,
    );
    doc.text(`${i} / ${pageCount}`, pageWidth - marginX, pageHeight - 24, {
      align: "right",
    });
  }

  return doc;
}

export function downloadMealPlanPdf(data: MealPlanPdfData) {
  const doc = generateMealPlanPdf(data);
  const safeName = (data.client_name || "meal-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  doc.save(`${safeName || "meal-plan"}-nutrition-plan.pdf`);
}