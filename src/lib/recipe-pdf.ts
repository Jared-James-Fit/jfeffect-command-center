import { jsPDF } from "jspdf";
import type { Recipe } from "@/lib/recipes";
import { getRecipeCardMeta } from "@/lib/recipe-meta";

function stripMarkdown(input: string): string {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[#>\-*]+\s?/, "").replace(/\*\*/g, "").replace(/\*/g, ""))
    .join("\n");
}

function slugify(s: string): string {
  return (s || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function downloadRecipePdf(recipe: Recipe): void {
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
  doc.setFontSize(20);
  doc.setTextColor(20, 20, 20);
  const titleLines = doc.splitTextToSize(recipe.title || "Recipe", pageWidth - marginX * 2);
  doc.text(titleLines, marginX, y);
  y += titleLines.length * 22;

  if (recipe.category) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(140, 140, 140);
    doc.text(recipe.category, marginX, y);
    y += 18;
  }
  y += 6;

  // Macros row
  const meta = getRecipeCardMeta(recipe);
  const cells: Array<{ label: string; value: string }> = [
    { label: "Calories", value: meta.calories != null ? String(meta.calories) : "—" },
    { label: "Protein", value: meta.protein != null ? `${meta.protein}g` : "—" },
    { label: "Carbs", value: meta.carbs != null ? `${meta.carbs}g` : "—" },
    { label: "Fats", value: meta.fats != null ? `${meta.fats}g` : "—" },
    { label: "Servings", value: meta.servings != null ? String(meta.servings) : "—" },
    { label: "Prep Time", value: meta.prepMinutes != null ? `${meta.prepMinutes}m` : "—" },
  ];
  const colW = (pageWidth - marginX * 2) / cells.length;
  cells.forEach((c, i) => {
    const cx = marginX + colW * i + colW / 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(c.value, cx, y + 14, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(c.label.toUpperCase(), cx, y + 28, { align: "center" });
  });
  y += 44;

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 18;

  // Body
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const body = stripMarkdown(recipe.body ?? "");
  const bodyLines = doc.splitTextToSize(body, pageWidth - marginX * 2);
  for (const line of bodyLines) {
    if (y > pageHeight - 60) {
      doc.addPage();
      y = 50;
    }
    doc.text(line, marginX, y);
    y += 13;
  }

  // Footer on every page
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

  doc.save(`${slugify(recipe.title)}-recipe.pdf`);
}