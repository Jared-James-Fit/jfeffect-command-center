/**
 * Downloads for Taxes & Books: the year-end package and GST/HST worksheet
 * (PDF), a receipts book (PDF, one receipt per page) and CSVs for the
 * accountant's software. Client-side only; jsPDF is loaded on demand.
 */
import { expenseCategory } from "@/lib/business-expense-categories";
import type { BooksData, ExpenseRow } from "@/lib/business-books";
import { toExpenseEntry } from "@/lib/business-books";
import { expenseTaxView, fmtCad, type BooksSnapshot } from "@/lib/business-tax";

const money = (minor: number) => fmtCad(minor);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function loadPdf() {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable: (autoTableMod as any).default ?? (autoTableMod as any).autoTable };
}

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function header(doc: any, title: string, subtitle: string, s: BooksSnapshot) {
  const margin = 40;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(s.settings.businessName, margin, 48);
  doc.setFontSize(13);
  doc.text(title, margin, 68);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(subtitle, margin, 84);
  doc.setTextColor(0);
  return 100;
}

function footer(doc: any, s: BooksSnapshot) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`${s.settings.businessName} · ${s.year} · Prepared with Cleo`, 40, h - 20);
    doc.text(`Page ${i} of ${pages}`, w - 40, h - 20, { align: "right" });
  }
  doc.setTextColor(0);
}

function sectionTitle(doc: any, text: string, y: number): number {
  const h = doc.internal.pageSize.getHeight();
  if (y > h - 120) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(text, 40, y);
  doc.setFont("helvetica", "normal");
  return y + 8;
}

function after(doc: any): number {
  return (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 24 : 120;
}

const TABLE = {
  styles: { fontSize: 8, cellPadding: 3 },
  headStyles: { fillColor: [35, 35, 35] as [number, number, number], textColor: 255 },
  margin: { left: 40, right: 40 },
};

function businessLine(s: BooksSnapshot) {
  const st = s.settings;
  const parts = [
    st.businessStructure === "corporation" ? "Corporation" : "Sole proprietor",
    `Province ${st.province}`,
    st.gstRegistered ? `GST/HST ${st.gstNumber ?? "(number not entered)"}, ${st.gstFilingFrequency} filer` : "Not GST/HST registered",
  ];
  if (st.accountantName) parts.push(`Accountant: ${st.accountantName}`);
  return parts.join("  ·  ");
}

export async function downloadYearEndPdf(s: BooksSnapshot, data: BooksData) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const status = s.inProgress ? `Year to date as of ${s.asOf} (year still open)` : `Full year, final as of ${s.asOf}`;
  let y = header(doc, `${s.year} Year-End Tax Package`, `${status}. Generated ${new Date().toLocaleDateString("en-CA")}.`, s);
  doc.setFontSize(9);
  doc.text(businessLine(s), 40, y);
  y += 14;
  doc.setTextColor(110);
  doc.text("Revenue counted when received. Income tax, CPP and CCA are estimates for planning; the accountant files the final figures.", 40, y, { maxWidth: 530 });
  doc.setTextColor(0);
  y += 22;

  y = sectionTitle(doc, "Summary", y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Item", "Amount"]],
    body: [
      ["Sales, GST/HST excluded (T2125 8000, GST line 101)", money(s.revenue.salesMinor)],
      ["GST/HST collected (line 103)", money(s.revenue.collectedMinor)],
      ["Payments received, tax included", `${money(s.revenue.grossMinor)} (${s.revenue.paymentCount})`],
      ["Refunds, tax included", `${money(s.revenue.refundsMinor)} (${s.revenue.refundCount})`],
      ["Expenses paid (all, tax included)", `${money(s.expenses.totalMinor)} (${s.expenses.count})`],
      ["Deductible expenses", money(s.expenses.deductibleMinor)],
      ["Capital cost allowance, first year (estimate)", money(s.expenses.ccaMinor)],
      ["Input tax credits (line 106)", money(s.expenses.itcMinor)],
      ["Net business income (T2125 9369)", money(s.profitMinor)],
      ["GST/HST net tax (line 109)", money(s.gst.netTaxMinor)],
      ["GST/HST already paid", money(s.gst.paidMinor)],
      ["GST/HST still owing", money(s.gst.owingMinor)],
      [s.settings.businessStructure === "corporation" ? "Corporate tax (estimate)" : "Income tax + CPP (estimate)", money(s.incomeTax.ytd.totalMinor)],
      ["Income tax already paid", money(s.incomeTax.paidMinor)],
      ["Income tax still owing (estimate)", money(s.incomeTax.owingNowMinor)],
    ],
    columnStyles: { 1: { halign: "right" } },
  });
  y = after(doc);

  y = sectionTitle(doc, "T2125 lines", y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Line", "Description", "Amount"]],
    body: s.t2125.map((l) => [l.line, l.label, money(l.amountMinor)]),
    columnStyles: { 2: { halign: "right" } },
  });
  y = after(doc);

  y = sectionTitle(doc, "Expenses by category", y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Category", "T2125", "Count", "Paid", "Deductible", "CCA", "ITC"]],
    body: s.expenses.byCategory.length
      ? s.expenses.byCategory.map((c) => [c.label, c.t2125Line ?? "-", String(c.count), money(c.totalMinor), money(c.deductibleMinor), money(c.ccaMinor), money(c.itcMinor)])
      : [["No expenses recorded", "", "", "", "", "", ""]],
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
  });
  y = after(doc);

  if (s.gst.registered) {
    y = sectionTitle(doc, "GST/HST", y);
    autoTable(doc, {
      ...TABLE,
      startY: y,
      head: [["Period", "101 Sales", "103 Collected", "106 ITCs", "109 Net tax", "File by", "Pay by"]],
      body: s.gst.periods.map((p) => [p.label, money(p.salesMinor), money(p.collectedMinor), money(p.itcMinor), money(p.netTaxMinor), p.filingDue, p.paymentDue]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    y = after(doc);
  }

  if (s.settings.businessStructure === "sole_proprietor") {
    const t = s.incomeTax.ytd;
    y = sectionTitle(doc, `Income tax and CPP estimate (${t.ratesYear} federal + Manitoba rates${t.ratesExact ? "" : ", latest loaded"})`, y);
    autoTable(doc, {
      ...TABLE,
      startY: y,
      head: [["Item", "Amount"]],
      body: [
        ["Net business income", money(t.netBusinessIncomeMinor)],
        ["Other income entered", money(s.settings.otherIncomeAnnualMinor)],
        ["CPP on self-employment (base + CPP2)", `${money(t.cpp.totalMinor)} (${money(t.cpp.baseMinor)} + ${money(t.cpp.cpp2Minor)})`],
        ["CPP deduction (line 22200)", money(t.cpp.deductionMinor)],
        ["Taxable income", money(t.taxableIncomeMinor)],
        ["Federal tax (on all income)", money(t.federalTaxMinor)],
        ["Manitoba tax (on all income)", money(t.provincialTaxMinor)],
        ["Income tax caused by the business", money(t.incomeTaxOnBusinessMinor)],
        ["Income tax + CPP from the business", money(t.totalMinor)],
        ["Marginal rate on the next business dollar", pct(t.marginalRate)],
      ],
      columnStyles: { 1: { halign: "right" } },
    });
    y = after(doc);
  }

  y = sectionTitle(doc, "By month", y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Month", "Sales", "GST/HST collected", "Expenses", "ITCs", "Profit"]],
    body: s.months.map((m) => [m.month, money(m.salesMinor), money(m.collectedMinor), money(m.expensesMinor), money(m.itcMinor), money(m.profitMinor)]),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
  });

  const revenue = data.revenue.filter((r) => r.date.startsWith(String(s.year)));
  doc.addPage();
  y = sectionTitle(doc, `Revenue detail (${revenue.length})`, 50);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Date", "Type", "Client", "Product", "Method", "Gross", "GST/HST", "Net"]],
    body: revenue.map((r) => {
      const sign = r.kind === "refund" ? -1 : 1;
      return [r.date, r.kind === "refund" ? "Refund" : "Payment", r.clientName ?? "-", r.product ?? "-", r.method ?? "-", money(sign * r.grossMinor), `${money(sign * r.taxMinor)}${r.taxEstimated ? "*" : ""}`, money(sign * (r.grossMinor - r.taxMinor))];
    }),
    columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });
  y = after(doc);

  const expenses = data.expenses.filter((e) => e.expense_date.startsWith(String(s.year))).sort((a, b) => a.expense_date.localeCompare(b.expense_date));
  y = sectionTitle(doc, `Expense detail (${expenses.length})`, y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Date", "Vendor", "Category", "Paid", "GST/HST", "Use", "Deductible", "Receipt"]],
    body: expenses.length
      ? expenses.map((e) => {
          const v = expenseTaxView(toExpenseEntry(e), s.settings.gstRegistered);
          return [e.expense_date, e.vendor ?? "-", expenseCategory(e.category).label, `${money(Number(e.amount_minor))}${e.currency !== "CAD" ? ` ${e.currency}` : ""}`, money(Number(e.tax_minor)), `${Number(e.business_use_pct)}%`, money(v.deductibleMinor + v.ccaMinor), e.receipt_path ? "Yes" : e.source === "stripe_fees" ? "Stripe" : "No"];
        })
      : [["No expenses recorded", "", "", "", "", "", "", ""]],
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 6: { halign: "right" } },
  });
  y = after(doc);

  const payments = data.taxPayments.filter((p) => p.tax_year === s.year);
  y = sectionTitle(doc, "Tax payments made", y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Paid on", "Type", "Period", "Reference", "Amount"]],
    body: payments.length
      ? payments.map((p) => [p.paid_on, p.kind === "gst_hst" ? "GST/HST" : "Income tax", p.period_label ?? "-", p.reference ?? "-", money(Number(p.amount_minor))])
      : [["None recorded", "", "", "", ""]],
    columnStyles: { 4: { halign: "right" } },
  });
  y = after(doc);

  y = sectionTitle(doc, "Notes for the accountant", y);
  const notes = s.issues.length ? s.issues.map((i) => [i.title, i.detail]) : [["Nothing flagged", ""]];
  if (revenue.some((r) => r.taxEstimated)) notes.push(["* Refund GST/HST", "Estimated pro rata from the original payment."]);
  autoTable(doc, { ...TABLE, startY: y, head: [["Item", "Detail"]], body: notes, columnStyles: { 0: { cellWidth: 170 } } });

  footer(doc, s);
  doc.save(`${slug(s.settings.businessName)}-${s.year}-year-end-package.pdf`);
}

export async function downloadGstWorksheetPdf(s: BooksSnapshot) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = header(doc, `${s.year} GST/HST Return Worksheet`, `${businessLine(s)}. Generated ${new Date().toLocaleDateString("en-CA")}.`, s);
  y += 6;
  for (const p of s.gst.periods) {
    y = sectionTitle(doc, `${p.label}: ${p.start} to ${p.end}${p.closed ? "" : " (period still open)"}`, y);
    autoTable(doc, {
      ...TABLE,
      startY: y,
      head: [["Line", "Description", "Amount"]],
      body: [
        ["101", "Sales and other revenue (GST/HST excluded)", money(p.salesMinor)],
        ["103", "GST/HST collected or collectible", money(p.collectedMinor)],
        ["104", "Adjustments", money(0)],
        ["105", "Total GST/HST and adjustments", money(p.collectedMinor)],
        ["106", "Input tax credits", money(p.itcMinor)],
        ["107", "Adjustments", money(0)],
        ["108", "Total ITCs and adjustments", money(p.itcMinor)],
        ["109", "Net tax", money(p.netTaxMinor)],
        ["", "File by / pay by", `${p.filingDue} / ${p.paymentDue}`],
      ],
      columnStyles: { 0: { cellWidth: 40 }, 2: { halign: "right" } },
    });
    y = after(doc);
  }
  y = sectionTitle(doc, "Year", y);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [["Item", "Amount"]],
    body: [
      ["Net tax for the year", money(s.gst.netTaxMinor)],
      ["Already paid (instalments and remittances)", money(s.gst.paidMinor)],
      ["Balance owing", money(s.gst.owingMinor)],
    ],
    columnStyles: { 1: { halign: "right" } },
  });
  y = after(doc);
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text("ITCs are claimed only for expenses with a receipt showing the GST/HST. PST/RST is not claimable and is not included.", 40, y, { maxWidth: 530 });
  footer(doc, s);
  doc.save(`${slug(s.settings.businessName)}-${s.year}-gst-hst-worksheet.pdf`);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = dataUrl;
  });
}

/** One receipt per page with its bookkeeping line on top. */
export async function downloadReceiptsPdf(
  s: BooksSnapshot,
  expenses: ExpenseRow[],
  getSignedUrl: (path: string) => Promise<string | null>,
  onProgress?: (done: number, total: number) => void,
) {
  const { jsPDF } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const withReceipts = expenses
    .filter((e) => e.receipt_path && e.expense_date.startsWith(String(s.year)))
    .sort((a, b) => a.expense_date.localeCompare(b.expense_date));

  header(doc, `${s.year} Receipts`, `${withReceipts.length} receipts, in date order. Generated ${new Date().toLocaleDateString("en-CA")}.`, s);
  let n = 0;
  for (const e of withReceipts) {
    n++;
    onProgress?.(n, withReceipts.length);
    doc.addPage();
    const v = expenseTaxView(toExpenseEntry(e), s.settings.gstRegistered);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`${n}. ${e.expense_date}  ${e.vendor ?? "Unknown vendor"}`, 40, 46);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(
      `${expenseCategory(e.category).label}  ·  Paid ${money(Number(e.amount_minor))}  ·  GST/HST ${money(Number(e.tax_minor))}  ·  Business use ${Number(e.business_use_pct)}%  ·  Deductible ${money(v.deductibleMinor + v.ccaMinor)}`,
      40,
      62,
    );
    if (e.description) doc.text(e.description.slice(0, 140), 40, 76);
    const top = 90;
    try {
      const url = await getSignedUrl(e.receipt_path!);
      if (!url) throw new Error("No link");
      if ((e.receipt_mime ?? "").includes("pdf")) {
        doc.text("PDF receipt on file in the app (Taxes & Books > Expenses).", 40, top + 10);
        continue;
      }
      const blob = await (await fetch(url)).blob();
      const dataUrl = await blobToDataUrl(blob);
      const { w, h } = await imageSize(dataUrl);
      const maxW = W - 80;
      const maxH = H - top - 40;
      const scale = Math.min(maxW / w, maxH / h);
      const fmt = dataUrl.startsWith("data:image/png") ? "PNG" : dataUrl.startsWith("data:image/webp") ? "WEBP" : "JPEG";
      doc.addImage(dataUrl, fmt, 40, top, w * scale, h * scale);
    } catch {
      doc.setTextColor(180, 0, 0);
      doc.text("Receipt image could not be loaded. Open it in the app.", 40, top + 10);
      doc.setTextColor(0);
    }
  }
  footer(doc, s);
  doc.save(`${slug(s.settings.businessName)}-${s.year}-receipts.pdf`);
  return withReceipts.length;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const dollars = (minor: number) => (minor / 100).toFixed(2);

export function downloadRevenueCsv(s: BooksSnapshot, data: BooksData) {
  const rows = data.revenue.filter((r) => r.date.startsWith(String(s.year)));
  const lines = [
    ["date", "type", "client", "product", "method", "gross", "gst_hst", "net", "currency", "gst_estimated", "source", "reference"].join(","),
    ...rows.map((r) => {
      const sign = r.kind === "refund" ? -1 : 1;
      return [r.date, r.kind, r.clientName, r.product, r.method, dollars(sign * r.grossMinor), dollars(sign * r.taxMinor), dollars(sign * (r.grossMinor - r.taxMinor)), r.currency, r.taxEstimated ? "yes" : "", r.source, r.reference]
        .map(csvCell)
        .join(",");
    }),
  ];
  downloadText(`${slug(s.settings.businessName)}-${s.year}-revenue.csv`, lines.join("\n"));
}

export function downloadExpensesCsv(s: BooksSnapshot, data: BooksData) {
  const rows = data.expenses.filter((e) => e.expense_date.startsWith(String(s.year))).sort((a, b) => a.expense_date.localeCompare(b.expense_date));
  const lines = [
    ["date", "vendor", "description", "category", "t2125_line", "amount", "gst_hst", "business_use_pct", "deductible", "cca", "itc", "currency", "payment_method", "receipt", "status", "source", "notes"].join(","),
    ...rows.map((e) => {
      const cat = expenseCategory(e.category);
      const v = expenseTaxView(toExpenseEntry(e), s.settings.gstRegistered);
      return [
        e.expense_date, e.vendor, e.description, cat.label, cat.t2125Line, dollars(Number(e.amount_minor)), dollars(Number(e.tax_minor)), Number(e.business_use_pct),
        dollars(v.deductibleMinor), dollars(v.ccaMinor), dollars(v.itcMinor), e.currency, e.payment_method, e.receipt_path ? "yes" : "no", e.status, e.source, e.notes,
      ].map(csvCell).join(",");
    }),
  ];
  downloadText(`${slug(s.settings.businessName)}-${s.year}-expenses.csv`, lines.join("\n"));
}
