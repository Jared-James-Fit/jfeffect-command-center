import { jsPDF } from "jspdf";

export type NutritionTargetsPdfInput = {
  name?: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  water?: number;
  notes?: string;
  coachName?: string;
  updatedAt?: string;
};

export function downloadNutritionTargetsPdf(targets: NutritionTargetsPdfInput): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  let y = 50;

  // Header
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(140, 140, 140);
  doc.text("JF Effect", marginX, y);
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(20, 20, 20);
  doc.text("Nutrition Targets", marginX, y);
  y += 26;

  if (targets.name) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text(targets.name, marginX, y);
    y += 18;
  }
  y += 10;

  // 4 macro cards
  const cards = [
    { label: "Calories", value: String(Math.round(targets.calories)) },
    { label: "Protein (g)", value: String(Math.round(targets.protein)) },
    { label: "Carbs (g)", value: String(Math.round(targets.carbs)) },
    { label: "Fats (g)", value: String(Math.round(targets.fats)) },
  ];
  const gap = 12;
  const cardW = (pageWidth - marginX * 2 - gap * 3) / 4;
  const cardH = 80;
  cards.forEach((c, i) => {
    const x = marginX + (cardW + gap) * i;
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(248, 248, 248);
    doc.roundedRect(x, y, cardW, cardH, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(20, 20, 20);
    doc.text(c.value, x + cardW / 2, y + 40, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(c.label.toUpperCase(), x + cardW / 2, y + 62, { align: "center" });
  });
  y += cardH + 24;

  if (targets.water != null) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text("Water Target", marginX, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    doc.text(`${targets.water} ml`, marginX, y);
    y += 22;
  }

  if (targets.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text("Notes", marginX, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    const lines = doc.splitTextToSize(targets.notes, pageWidth - marginX * 2);
    for (const line of lines) {
      if (y > pageHeight - 80) {
        doc.addPage();
        y = 50;
      }
      doc.text(line, marginX, y);
      y += 13;
    }
    y += 10;
  }

  if (targets.coachName || targets.updatedAt) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const parts: string[] = [];
    if (targets.coachName) parts.push(`Coach: ${targets.coachName}`);
    if (targets.updatedAt) parts.push(`Updated: ${targets.updatedAt}`);
    doc.text(parts.join("  ·  "), marginX, y);
  }

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text(
      "Generated from JF Effect · jfeffect.com",
      pageWidth / 2,
      pageHeight - 24,
      { align: "center" },
    );
  }

  doc.save("nutrition-targets.pdf");
}