/**
 * A sale's record as a PDF (Nov 22 2026), drawn with the JF Effect PDF kit:
 * the admin's Sales ⋯ and the sale page. What was bought, when, the amount
 * and status as stored, the service term and its date changes. Private notes
 * are marked private: this copy is the business's, not a receipt.
 */
import { PdfDoc } from "@/lib/pdf/kit";
import { pdfDate, pdfFileName, pdfNumber, pdfText } from "@/lib/pdf/text";
import { deliverPdf, loadPdfLogo } from "@/lib/pdf/deliver";
import { billingDay } from "@/lib/date-range";

export function buildPurchasePdf(
  r: any,
  clientName: string | null | undefined,
  opts: { logo?: string | null } = {},
): PdfDoc {
  const amount =
    r.full_payable_amount != null
      ? `${r.currency ?? "CAD"} ${pdfNumber(Number(r.full_payable_amount), 2)}`
      : null;
  const pdf = new PdfDoc({
    kind: "Purchase record",
    title: pdfText(r.offer_name) || "Purchase",
    subtitle: r.purchased_at ? `Bought ${pdfDate(r.purchased_at)}` : null,
    person: clientName ?? null,
    logo: opts.logo,
    facts: [
      ["Client", clientName ?? null],
      ["Amount", amount],
      ["Payment", pdfText(r.payment_status) || null],
      ["Service", pdfText(r.service_status) || null],
    ],
  });
  pdf.heading("Details", { keepWith: 60 });
  pdf.details([
    [
      "Product",
      `${pdfText(r.offer_name) || "–"}${r.offer_version ? ` (version ${r.offer_version})` : ""}`,
    ],
    ["Product type", pdfText(r.offer_type) || null],
    ["Purchase date", r.purchased_at ? pdfDate(r.purchased_at) : null],
    ["Service start", billingDay(r.term_start_date, { year: "always" }) ?? "Not set"],
    ["Service end", billingDay(r.term_end_date, { year: "always" }) ?? "Not set"],
    [
      "Term",
      pdfText(r.term_duration_text) ||
        (r.term_length_snapshot
          ? `${r.term_length_snapshot} ${r.term_unit_snapshot ?? ""}`.trim()
          : null),
    ],
    ["Record", r.id ? String(r.id) : null],
  ]);
  const history: any[] = (r.term_date_history ?? []).slice(-20);
  if (history.length) {
    pdf.heading("Date changes", { level: 2, keepWith: 50 });
    pdf.table({
      columns: [
        { header: "Changed", width: 80, muted: true },
        { header: "Start", width: 90 },
        { header: "End", width: 90 },
        { header: "Why", width: "auto" },
      ],
      rows: history.map((h) => [
        h.changed_at ? pdfDate(h.changed_at) : null,
        h.start_date ? pdfDate(h.start_date) : null,
        h.end_date ? pdfDate(h.end_date) : null,
        pdfText(h.reason) || "",
      ]),
    });
  }
  if (pdfText(r.admin_notes)) {
    pdf.callout("Private notes", r.admin_notes, { tone: "warn" });
  }
  return pdf;
}

export async function purchasePdfFile(r: any, clientName?: string | null): Promise<File> {
  return buildPurchasePdf(r, clientName, { logo: await loadPdfLogo() }).toFile(
    pdfFileName({ person: clientName, document: "purchase", detail: r.offer_name ?? null }),
  );
}

export async function deliverPurchasePdf(r: any, clientName?: string | null): Promise<void> {
  await deliverPdf(await purchasePdfFile(r, clientName), "Purchase record");
}
