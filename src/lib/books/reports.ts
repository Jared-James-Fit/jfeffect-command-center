/**
 * Reports for any period, built from the same figures the screens show
 * (pure, tested), so an export always matches what's on screen: a profit and
 * loss statement, every transaction, what's owed, and the GST/HST lines.
 * Cents in, dollars out (two decimals, a minus sign for money out).
 */
import type { LedgerEntry, MoneyFigures } from "@/lib/books/money-view";
import { methodWord } from "@/lib/books/money-view";
import type { Receivables } from "@/lib/books/receivables";

export type StatementRow = { label: string; minor: number | null; prevMinor?: number | null; strong?: boolean; indent?: boolean; note?: string };

const dollars = (minor: number | null | undefined) => (minor == null ? "" : (minor / 100).toFixed(2));

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

/** Profit and loss: sales by service, spending by category, profit; GST/HST and taxable profit as memos below the line. */
export function profitAndLoss(f: MoneyFigures, prev: MoneyFigures | null, gstRegistered: boolean): StatementRow[] {
  const prevService = new Map((prev?.byService ?? []).map((b) => [b.key, b.minor]));
  const prevCat = new Map((prev?.byCategory ?? []).map((b) => [b.key, b.minor]));
  const rows: StatementRow[] = [
    { label: "Sales (before GST/HST, after refunds)", minor: null, strong: true },
    ...f.byService.map((b) => ({ label: b.label, minor: b.minor, prevMinor: prev ? prevService.get(b.key) ?? 0 : undefined, indent: true })),
    { label: "Total sales", minor: f.sales.netMinor, prevMinor: prev?.sales.netMinor, strong: true },
    { label: "Business expenses (before GST/HST claimed back)", minor: null, strong: true },
    ...f.byCategory.map((c) => ({ label: c.label, minor: c.minor, prevMinor: prev ? prevCat.get(c.key) ?? 0 : undefined, indent: true })),
    { label: "Total expenses", minor: f.spent.minor, prevMinor: prev?.spent.minor, strong: true },
    { label: "Profit before income tax", minor: f.profitMinor, prevMinor: prev?.profitMinor, strong: true },
    { label: "Memo: refunds paid (with GST/HST)", minor: f.sales.refundsMinor, prevMinor: prev?.sales.refundsMinor },
    { label: "Memo: taxable profit (deductible expenses and CCA)", minor: f.taxableProfitMinor, prevMinor: prev?.taxableProfitMinor, note: "Estimate. Meals are half deductible; equipment is claimed as CCA." },
  ];
  if (gstRegistered) {
    rows.push(
      { label: "Memo: GST/HST collected", minor: f.gst.collectedMinor, prevMinor: prev?.gst.collectedMinor },
      { label: "Memo: GST/HST input tax credits", minor: f.gst.itcMinor, prevMinor: prev?.gst.itcMinor },
      { label: "Memo: net GST/HST", minor: f.gst.netMinor, prevMinor: prev?.gst.netMinor, note: "Positive: owed to CRA. Not income or an expense." },
    );
  }
  if (f.spent.personalMinor) rows.push({ label: "Memo: personal spending left out", minor: f.spent.personalMinor, prevMinor: prev?.spent.personalMinor });
  return rows;
}

export function statementCsv(title: string, periodLabel: string, vsLabel: string | null, rows: StatementRow[]): string {
  const head = vsLabel ? ["line", periodLabel, vsLabel, "note"] : ["line", periodLabel, "note"];
  return csv([
    [title],
    head,
    ...rows.map((r) => {
      const label = r.indent ? `  ${r.label}` : r.label;
      return vsLabel ? [label, dollars(r.minor), dollars(r.prevMinor ?? null), r.note ?? ""] : [label, dollars(r.minor), r.note ?? ""];
    }),
  ]);
}

const KIND_WORD: Record<LedgerEntry["kind"], string> = { in: "Payment", refund: "Refund", out: "Expense", tax: "Tax payment" };

/** Every transaction shown, one per line, for a spreadsheet or the accountant's software. */
export function transactionsCsv(rows: LedgerEntry[]): string {
  return csv([
    ["date", "type", "who", "service_or_category", "detail", "method", "amount", "gst_hst_or_itc", "before_gst_hst", "currency", "flags", "reference"],
    ...[...rows]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => [
        r.date, KIND_WORD[r.kind], r.who, r.what, r.detail ?? "", r.method ? methodWord(r.method) : "",
        dollars(r.amountMinor), dollars(r.taxMinor), dollars(r.netMinor), r.currency, r.flags.join(" "), r.reference ?? "",
      ]),
  ]);
}

/** What's owed today, client by client, with how it gets paid; links nobody paid listed apart. */
export function receivablesCsv(r: Receivables): string {
  return csv([
    [`Owed as of ${r.asOf} (with GST/HST)`],
    ["client", "for", "outstanding", "overdue", "due_now", "scheduled", "no_dates", "next_payment", "next_date", "how", "overdue_since"],
    ...r.lines.map((l) => [
      l.client, l.label, dollars(l.outstandingCents), dollars(l.overdueCents), dollars(l.dueNowCents), dollars(l.scheduledCents), dollars(l.unscheduledCents),
      dollars(l.next?.cents ?? null), l.next?.date ?? "", l.how, l.overdueSince ?? "",
    ]),
    ["Total", "", dollars(r.outstandingCents), dollars(r.overdueCents), dollars(r.dueNowCents), dollars(r.scheduledCents), dollars(r.unscheduledCents)],
    [],
    ["Payment links not paid yet (not owed)"],
    ["client", "for", "amount", "since"],
    ...r.waiting.map((w) => [w.client, w.name, dollars(w.cents), w.since ?? ""]),
  ]);
}

/** The GST/HST return's lines for a period (regular method). */
export function gstLines(f: MoneyFigures): Array<{ line: string; label: string; minor: number }> {
  return [
    { line: "101", label: "Sales and other revenue (GST/HST excluded)", minor: f.sales.netMinor },
    { line: "103", label: "GST/HST collected", minor: f.gst.collectedMinor },
    { line: "106", label: "Input tax credits", minor: f.gst.itcMinor },
    { line: "109", label: "Net tax", minor: f.gst.netMinor },
  ];
}

export function gstCsv(periodLabel: string, f: MoneyFigures): string {
  return csv([[`GST/HST, ${periodLabel} (regular method)`], ["line", "description", "amount"], ...gstLines(f).map((l) => [l.line, l.label, dollars(l.minor)])]);
}
