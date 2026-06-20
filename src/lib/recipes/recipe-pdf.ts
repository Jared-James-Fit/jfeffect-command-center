import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Recipe } from "@/lib/recipes";
import { parseRecipeBody } from "@/lib/recipe-format";
import { getRecipeCardMeta } from "@/lib/recipe-meta";

function findField(
  sections: ReturnType<typeof parseRecipeBody>["sections"],
  label: string,
): string | null {
  const s = sections.find(
    (x) => x.kind === "field" && x.label.toLowerCase() === label.toLowerCase(),
  );
  return s && s.kind === "field" ? s.value : null;
}

function findList(
  sections: ReturnType<typeof parseRecipeBody>["sections"],
  label: string,
): string[] {
  const s = sections.find(
    (x) => x.kind === "list" && x.label.toLowerCase() === label.toLowerCase(),
  );
  return s && s.kind === "list" ? s.items : [];
}

export function generateRecipePdf(recipe: Recipe): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  let y = 48;

  const parsed = parseRecipeBody(recipe.body ?? "");
  const meta = getRecipeCardMeta(recipe);
  const ingredients = findList(parsed.sections, "Ingredients");
  const instructions = findList(parsed.sections, "Instructions");
  const notes = findList(parsed.sections, "Notes");
  const prepTime = findField(parsed.sections, "Prep Time");
  const cookTime = findField(parsed.sections, "Cook Time");
  const totalTime = findField(parsed.sections, "Total Time");

  // Brand bar
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, pageWidth, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("JF EFFECT", marginX, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Recipe", marginX, 54);

  doc.setTextColor(20, 20, 20);
  y = 100;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(
    recipe.title || "Recipe",
    pageWidth - marginX * 2,
  );
  doc.text(titleLines, marginX, y);
  y += titleLines.length * 18;

  // Category + tags
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const metaLine: string[] = [];
  if (recipe.category) metaLine.push(recipe.category);
  if (Array.isArray(recipe.tags) && recipe.tags.length) {
    metaLine.push(recipe.tags.join(", "));
  }
  if (metaLine.length) {
    const lines = doc.splitTextToSize(metaLine.join("  •  "), pageWidth - marginX * 2);
    doc.text(lines, marginX, y);
    y += lines.length * 13;
  }
  y += 4;

  // Stats / macros table
  const statRows: [string, string][] = [];
  if (meta.servings != null) statRows.push(["Servings", String(meta.servings)]);
  if (meta.prepMinutes != null) statRows.push(["Prep (min)", String(meta.prepMinutes)]);
  if (prepTime && meta.prepMinutes == null) statRows.push(["Prep Time", prepTime]);
  if (cookTime) statRows.push(["Cook Time", cookTime]);
  if (totalTime) statRows.push(["Total Time", totalTime]);
  if (meta.calories != null) statRows.push(["Calories", String(meta.calories)]);
  if (meta.protein != null) statRows.push(["Protein (g)", String(meta.protein)]);
  if (meta.carbs != null) statRows.push(["Carbs (g)", String(meta.carbs)]);
  if (meta.fats != null) statRows.push(["Fats (g)", String(meta.fats)]);

  if (statRows.length) {
    autoTable(doc, {
      startY: y,
      body: statRows,
      styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 110, textColor: [60, 60, 60] },
        1: { cellWidth: "auto" },
      },
      theme: "grid",
      margin: { left: marginX, right: marginX },
    });
    y = (doc as any).lastAutoTable?.finalY ?? y;
    y += 14;
  }

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 60) {
      doc.addPage();
      y = 56;
    }
  };

  const sectionHeader = (label: string) => {
    ensureSpace(28);
    doc.setFillColor(15, 15, 15);
    doc.rect(marginX, y, pageWidth - marginX * 2, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label, marginX + 10, y + 14);
    y += 28;
    doc.setTextColor(20, 20, 20);
  };

  const writeList = (items: string[], ordered: boolean) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    items.forEach((item, i) => {
      const prefix = ordered ? `${i + 1}. ` : "• ";
      const lines = doc.splitTextToSize(prefix + item, pageWidth - marginX * 2);
      ensureSpace(lines.length * 13 + 2);
      doc.text(lines, marginX, y);
      y += lines.length * 13 + 2;
    });
    y += 6;
  };

  if (ingredients.length) {
    sectionHeader("Ingredients");
    writeList(ingredients, false);
  }

  if (instructions.length) {
    sectionHeader("Instructions");
    writeList(instructions, true);
  }

  if (notes.length) {
    sectionHeader("Notes");
    writeList(notes, false);
  }

  if (!ingredients.length && !instructions.length && !notes.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    const msg = "Full ingredients and instructions haven't been added to this recipe yet.";
    const lines = doc.splitTextToSize(msg, pageWidth - marginX * 2);
    doc.text(lines, marginX, y);
    y += lines.length * 13;
  }

  // Footer
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text("Generated from JF Effect Client Portal", marginX, pageHeight - 24);
    doc.text(`${i} / ${pageCount}`, pageWidth - marginX, pageHeight - 24, {
      align: "right",
    });
  }

  return doc;
}

export function downloadRecipePdf(recipe: Recipe) {
  const doc = generateRecipePdf(recipe);
  const safeName = (recipe.title || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  doc.save(`${safeName || "recipe"}.pdf`);
}