/**
 * The grocery list PDF (Nov 22 2026), drawn with the JF Effect PDF kit: what
 * to buy for a week or two of the coach's meal plan, in the order you walk
 * the store, each item with a tick box, how much to buy and why that much.
 * The same rows as the sheet (grocery-shop.ts); nothing is worked out here.
 */
import { PdfDoc, PDF_COLOR } from "@/lib/pdf/kit";
import { pdfFileName, pdfText } from "@/lib/pdf/text";
import { deliverPdf, loadPdfLogo } from "@/lib/pdf/deliver";
import type { ShopRow, StoreAisle } from "@/lib/grocery-shop";
import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_TITLE } from "@/lib/nutrition-disclaimer";

export type GroceryPdfData = {
  clientName?: string | null;
  rangeLabel: string;
  spanLabel: string;
  weekSummary?: string | null;
  groups: { aisle: StoreAisle; items: ShopRow[] }[];
};

export function buildGroceryListPdf(d: GroceryPdfData, opts: { logo?: string | null; generatedAt?: Date } = {}): PdfDoc {
  const count = d.groups.reduce((n, g) => n + g.items.length, 0);
  const pdf = new PdfDoc({
    kind: "Grocery list",
    title: `${d.spanLabel} of groceries`,
    subtitle: d.rangeLabel,
    person: d.clientName ?? null,
    logo: opts.logo,
    generatedAt: opts.generatedAt,
    facts: [
      ["For", d.clientName ?? null],
      ["Covers", pdfText(d.weekSummary) || d.spanLabel],
      ["Items", count ? String(count) : null],
    ],
  });
  pdf.paragraph(
    "Amounts are what to buy: cooked plan weights for meat, rice and potatoes are turned into raw or dry weight and rounded up to real package sizes. The list follows the order you walk the store.",
    { size: 9, color: PDF_COLOR.muted, gapAfter: 8 },
  );
  if (!count) pdf.paragraph("Nothing to buy: the meal plan has no foods for these dates yet.", { color: PDF_COLOR.muted });
  for (const g of d.groups) {
    if (!g.items.length) continue;
    const sub = new Map<string, string>();
    g.items.forEach((r, i) => {
      const detail = [pdfText(r.detail), pdfText(r.tip)].filter(Boolean).join(" · ");
      if (detail) sub.set(`${i}:1`, detail);
    });
    pdf.heading(g.aisle, { level: 2, keepWith: 60 });
    pdf.table({
      columns: [
        { header: "", width: 22 },
        { header: "Item", width: "auto", bold: true },
        { header: "Buy", width: "fit", max: 170, align: "right" },
      ],
      rows: g.items.map((r) => ["", pdfText(r.name.charAt(0).toUpperCase() + r.name.slice(1)), pdfText(r.buy)]),
      sub,
      checkColumn: 0,
      hideHeader: true,
      keepTogether: g.items.length <= 18,
      gapAfter: 8,
    });
  }
  pdf.heading("Spend less", { level: 3, keepWith: 30 });
  pdf.paragraph(
    "No Frills, Food Basics, FreshCo and Walmart are cheapest for staples. Costco wins on chicken, eggs, rice and whey. Buy family packs and freeze what you won't eat in 3 days. Frozen fruit and vegetables are as good as fresh.",
    { size: 9 },
  );
  pdf.callout(NUTRITION_DISCLAIMER_TITLE, NUTRITION_DISCLAIMER, { size: 7.75 });
  return pdf;
}

export function generateGroceryListPdf(d: GroceryPdfData) {
  return buildGroceryListPdf(d).finish();
}

/** Makes the list and hands it over (the share sheet on a phone, a download on a computer). */
export async function downloadGroceryListPdf(d: GroceryPdfData) {
  const file = buildGroceryListPdf(d, { logo: await loadPdfLogo() }).toFile(pdfFileName({ person: d.clientName, document: "grocery list", detail: d.spanLabel }));
  return deliverPdf(file, "Grocery list");
}
