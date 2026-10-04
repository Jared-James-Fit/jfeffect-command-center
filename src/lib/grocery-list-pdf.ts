/**
 * Branded, printable grocery list (A4) — JF Effect header, store-aisle
 * sections with tick boxes, buying amounts, tips and the nutrition disclaimer.
 */
import { jsPDF } from "jspdf";
import type { ShopRow, StoreAisle } from "@/lib/grocery-shop";
import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_TITLE } from "@/lib/nutrition-disclaimer";

export type GroceryPdfData = {
  clientName?: string | null;
  rangeLabel: string;
  spanLabel: string;
  weekSummary?: string | null;
  groups: { aisle: StoreAisle; items: ShopRow[] }[];
};

/** Helvetica in jsPDF only covers Latin-1: swap symbols it can't draw. */
const clean = (s: string) =>
  s.replace(/≈/g, "~").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF—–·×…]/g, "").trim();

export function generateGroceryListPdf(d: GroceryPdfData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const mx = 40;
  const maxW = W - mx * 2;
  let y = 0;

  const header = () => {
    doc.setFillColor(15, 15, 15);
    doc.rect(0, 0, W, 72, "F");
    doc.setFillColor(239, 51, 64);
    doc.rect(0, 72, W, 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("JF EFFECT", mx, 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Grocery List", mx, 54);
    doc.text(d.spanLabel, W - mx, 36, { align: "right" });
    doc.text(d.rangeLabel, W - mx, 54, { align: "right" });
  };
  const ensure = (need: number) => {
    if (y + need > H - 50) {
      doc.addPage();
      header();
      y = 100;
    }
  };

  header();
  y = 100;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(d.clientName ? `${d.clientName} — ${d.spanLabel} of groceries` : `${d.spanLabel} of groceries`, mx, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90, 90, 90);
  const intro = doc.splitTextToSize(
    `${d.weekSummary ? d.weekSummary + ". " : ""}Amounts are what to BUY: cooked plan weights for meat, rice and potatoes are converted to raw / dry weight and rounded up to real package sizes. Sorted in the order you walk the store.`,
    maxW,
  );
  doc.text(intro, mx, y);
  y += intro.length * 12 + 10;

  for (const g of d.groups) {
    ensure(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(239, 51, 64);
    doc.text(g.aisle.toUpperCase(), mx, y);
    y += 6;
    doc.setDrawColor(230);
    doc.line(mx, y, W - mx, y);
    y += 14;
    for (const r of g.items) {
      const detail = clean([r.detail, r.tip].filter(Boolean).join("  ·  "));
      const detailLines = detail ? doc.splitTextToSize(detail, maxW - 26) : [];
      ensure(18 + detailLines.length * 10);
      doc.setDrawColor(120);
      doc.rect(mx, y - 9, 10, 10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(20, 20, 20);
      const name = clean(r.name.charAt(0).toUpperCase() + r.name.slice(1));
      doc.text(name, mx + 18, y);
      doc.setTextColor(239, 51, 64);
      doc.text(clean(r.buy), W - mx, y, { align: "right" });
      y += 12;
      if (detailLines.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(110, 110, 110);
        doc.text(detailLines, mx + 18, y);
        y += detailLines.length * 10;
      }
      y += 6;
    }
    y += 6;
  }

  ensure(50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text("SAVE MONEY", mx, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100, 100, 100);
  const save = doc.splitTextToSize(
    "No Frills, Food Basics, FreshCo and Walmart are cheapest for staples. Costco wins on chicken, eggs, rice and whey. Buy family packs and freeze what you won't eat in 3 days. Frozen fruit and vegetables are just as good as fresh.",
    maxW,
  );
  doc.text(save, mx, y);
  y += save.length * 10 + 14;

  const disc = doc.splitTextToSize(NUTRITION_DISCLAIMER, maxW);
  ensure(30 + disc.length * 10);
  doc.setDrawColor(239, 51, 64);
  doc.line(mx, y, W - mx, y);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(NUTRITION_DISCLAIMER_TITLE.toUpperCase(), mx, y);
  y += 12;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  doc.text(disc, mx, y);

  const pages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text("JF Effect · Grocery list built from your coach's meal plan", mx, H - 24);
    doc.text(`${i} / ${pages}`, W - mx, H - 24, { align: "right" });
  }
  return doc;
}

export function downloadGroceryListPdf(d: GroceryPdfData) {
  const doc = generateGroceryListPdf(d);
  const slug = (d.clientName || "grocery").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  doc.save(`${slug || "grocery"}-jf-effect-grocery-list.pdf`);
}
