/**
 * The money screens' numbers for any period (pure, tested): what the business
 * made, spent and kept, the GST/HST picture, where the money came from and
 * went, month by month, and one ledger of money in and out. Built on the same
 * pieces as Taxes & Books (business-tax.ts), so the two never disagree.
 *
 * Definitions (cash basis: money is counted on the day it moved):
 *   Sales     payments received less refunds, GST/HST taken out. What the
 *             business earned in the period: clients' payments, memberships,
 *             AI credit packs and other income (business_other_income).
 *   Collected payments received with their GST/HST, before refunds: the money
 *             that actually came in.
 *   Spent     business expenses paid, GST/HST you claim back (ITCs) taken out,
 *             only the business-use share, personal items left out. A capital
 *             purchase counts in full when it's paid (cash); the tax view
 *             spreads it as CCA instead.
 *   Profit    Sales − Spent, before income tax.
 *   Taxable profit (estimate) Sales − deductible expenses − CCA: what income
 *             tax is worked out on (meals are half deductible, capital items
 *             are CCA). Shown with taxes, never as the business's profit.
 *   GST/HST net  GST/HST collected (net of refunds) − input tax credits on
 *             expenses. Positive: payable to CRA. Negative: a refund.
 */
import type { ExpenseRow, RecurringExpenseRow, RevenueRow, TaxPaymentRow } from "@/lib/business-books";
import { toExpenseEntry } from "@/lib/business-books";
import { expenseCategory } from "@/lib/business-expense-categories";
import { estimateIncomeTax, expenseTaxView, missingTaxReason, revenueNetMinor, type ExpenseEntry, type RevenueEntry, type TaxSettings } from "@/lib/business-tax";
import { addDays, monthsBetween } from "@/lib/books/period";

export type Range = { start: string; end: string };

const inRange = (date: string, r: Range) => date >= r.start && date <= r.end;
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((t, r) => t + f(r), 0);
const taxSigned = (r: RevenueEntry) => (r.kind === "refund" ? -r.taxMinor : r.taxMinor);

// ---------------------------------------------------------------------------
// Services: what a payment was for, read from the sale's name (the stored
// offer type is unreliable: a personal training package was saved as
// "Online Coaching").

export type ServiceKey = "personal_training" | "coaching" | "membership" | "ai_credits" | "other_income" | "other";
export const SERVICE_LABEL: Record<ServiceKey, string> = {
  personal_training: "Personal training",
  coaching: "Coaching",
  membership: "Membership",
  ai_credits: "AI credits",
  other_income: "Other income",
  other: "Other",
};

export function serviceOf(r: Pick<RevenueEntry, "source" | "product">): ServiceKey {
  if (r.source === "membership") return "membership";
  if (r.source === "other") return "other_income";
  const p = (r.product ?? "").toLowerCase();
  if (p.startsWith("ai credits")) return "ai_credits";
  if (/personal training|1:1|\bsession|\bpt\b/.test(p)) return "personal_training";
  if (/coaching/.test(p)) return "coaching";
  return "other";
}

// ---------------------------------------------------------------------------
// One period's figures

export type Breakdown = { key: string; label: string; minor: number; count: number };

export type MoneyFigures = Range & {
  sales: {
    /** Before GST/HST, after refunds. */
    netMinor: number;
    /** Payments received with GST/HST, before refunds. */
    collectedMinor: number;
    /** Refunds paid back, with their GST/HST. */
    refundsMinor: number;
    gstMinor: number;
    paymentCount: number;
    refundCount: number;
  };
  spent: {
    /** Business cost: before the GST/HST you claim back, business-use share, personal left out. */
    minor: number;
    /** Everything paid out, taxes and personal items included (what left the bank). */
    paidMinor: number;
    itcMinor: number;
    deductibleMinor: number;
    ccaMinor: number;
    /** Business cost of capital purchases (counted in `minor`, claimed as CCA for tax). */
    capitalMinor: number;
    personalMinor: number;
    count: number;
  };
  profitMinor: number;
  /** Profit as a share of sales; null with no sales. */
  margin: number | null;
  taxableProfitMinor: number;
  gst: { collectedMinor: number; itcMinor: number; netMinor: number };
  byService: Breakdown[];
  byCategory: Array<Breakdown & { deductibleMinor: number; itcMinor: number }>;
  byMethod: Breakdown[];
  byClient: Breakdown[];
};

function group<T>(rows: T[], key: (r: T) => string, label: (k: string) => string, value: (r: T) => number): Breakdown[] {
  const m = new Map<string, { minor: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = m.get(k) ?? { minor: 0, count: 0 };
    cur.minor += value(r);
    cur.count += 1;
    m.set(k, cur);
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, label: label(k), ...v })).sort((a, b) => b.minor - a.minor);
}

export const methodWord = (m: string | null) =>
  !m ? "Other" : m === "etransfer" ? "E-transfer" : m === "stripe" ? "Card (Stripe)" : m === "paypal" ? "PayPal" : m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, " ");

export function moneyFigures(input: { revenue: RevenueEntry[]; expenses: ExpenseEntry[]; settings: TaxSettings; range: Range }): MoneyFigures {
  const { range, settings } = input;
  const reg = settings.gstRegistered;
  const rev = input.revenue.filter((r) => inRange(r.date, range));
  const exp = input.expenses.filter((e) => inRange(e.date, range));
  const pays = rev.filter((r) => r.kind === "payment");
  const refunds = rev.filter((r) => r.kind === "refund");
  const netMinor = sum(rev, revenueNetMinor);
  const gstMinor = reg ? sum(rev, taxSigned) : 0;

  const views = exp.map((e) => ({ e, v: expenseTaxView(e, reg), cat: expenseCategory(e.category) }));
  const spentMinor = sum(views, (x) => x.v.businessCostMinor);
  const deductibleMinor = sum(views, (x) => x.v.deductibleMinor);
  const ccaMinor = sum(views, (x) => x.v.ccaMinor);
  const itcMinor = sum(views, (x) => x.v.itcMinor);

  const byCategory = [...new Set(views.map((x) => x.cat.key))]
    .map((key) => {
      const rows = views.filter((x) => x.cat.key === key);
      return {
        key,
        label: rows[0].cat.label,
        minor: sum(rows, (x) => x.v.businessCostMinor),
        count: rows.length,
        deductibleMinor: sum(rows, (x) => x.v.deductibleMinor + x.v.ccaMinor),
        itcMinor: sum(rows, (x) => x.v.itcMinor),
      };
    })
    .filter((c) => c.key !== "personal")
    .sort((a, b) => b.minor - a.minor);

  const profitMinor = netMinor - spentMinor;
  return {
    ...range,
    sales: {
      netMinor,
      collectedMinor: sum(pays, (r) => r.grossMinor),
      refundsMinor: sum(refunds, (r) => r.grossMinor),
      gstMinor,
      paymentCount: pays.length,
      refundCount: refunds.length,
    },
    spent: {
      minor: spentMinor,
      paidMinor: sum(exp, (e) => e.amountMinor),
      itcMinor,
      deductibleMinor,
      ccaMinor,
      capitalMinor: sum(views.filter((x) => x.cat.kind === "capital"), (x) => x.v.businessCostMinor),
      personalMinor: sum(views.filter((x) => x.cat.kind === "excluded"), (x) => x.e.amountMinor),
      count: exp.length,
    },
    profitMinor,
    margin: netMinor > 0 ? profitMinor / netMinor : null,
    taxableProfitMinor: netMinor - deductibleMinor - ccaMinor,
    gst: { collectedMinor: gstMinor, itcMinor, netMinor: gstMinor - itcMinor },
    byService: group(rev, (r) => serviceOf(r), (k) => SERVICE_LABEL[k as ServiceKey] ?? k, revenueNetMinor),
    byCategory,
    byMethod: group(rev, (r) => r.method ?? "other", methodWord, revenueNetMinor),
    // Clients only: a sponsor or an affiliate payout isn't a client.
    byClient: group(rev.filter((r) => r.source !== "other"), (r) => r.clientName ?? "Unknown", (k) => k, revenueNetMinor),
  };
}

// ---------------------------------------------------------------------------
// Change against the comparison period

export type Change = { diffMinor: number; pct: number | null; direction: "up" | "down" | "flat" };

/** How much a figure moved. pct is null when there's nothing to compare with (a percent of zero means nothing). */
export function changeOf(cur: number, prev: number | null | undefined): Change | null {
  if (prev == null) return null;
  const diffMinor = cur - prev;
  const pct = prev !== 0 ? diffMinor / Math.abs(prev) : null;
  const direction = Math.abs(diffMinor) < 100 ? "flat" : diffMinor > 0 ? "up" : "down";
  return { diffMinor, pct, direction };
}

// ---------------------------------------------------------------------------
// Month by month

export type MonthPoint = {
  month: string;
  salesMinor: number;
  spentMinor: number;
  profitMinor: number;
  gstMinor: number;
  itcMinor: number;
  collectedMinor: number;
};

export function monthlySeries(input: { revenue: RevenueEntry[]; expenses: ExpenseEntry[]; settings: TaxSettings; months: string[] }): MonthPoint[] {
  const reg = input.settings.gstRegistered;
  return input.months.map((month) => {
    const rev = input.revenue.filter((r) => r.date.startsWith(month));
    const views = input.expenses.filter((e) => e.date.startsWith(month)).map((e) => expenseTaxView(e, reg));
    const salesMinor = sum(rev, revenueNetMinor);
    const spentMinor = sum(views, (v) => v.businessCostMinor);
    return {
      month,
      salesMinor,
      spentMinor,
      profitMinor: salesMinor - spentMinor,
      gstMinor: reg ? sum(rev, taxSigned) : 0,
      itcMinor: sum(views, (v) => v.itcMinor),
      collectedMinor: sum(rev.filter((r) => r.kind === "payment"), (r) => r.grossMinor),
    };
  });
}

/**
 * Income tax + CPP a period adds: for each tax year it touches, the estimate on
 * that year's taxable profit through the period's end less the estimate
 * through the day before it starts (the same estimate the Taxes tab shows for
 * the year so far, with that year's brackets, basic personal amount and CPP).
 * The periods of a year add up to the year's figure, so a month never claims
 * a top-bracket rate on profit that's still under the basic personal amount.
 * Never below zero (a losing month owes nothing extra). An estimate, never a
 * bill.
 */
export function periodTaxReserve(input: { revenue: RevenueEntry[]; expenses: ExpenseEntry[]; settings: TaxSettings; range: Range }): { minor: number; ratesExact: boolean } {
  const { revenue, expenses, settings, range } = input;
  let minor = 0;
  let ratesExact = true;
  for (let y = Number(range.start.slice(0, 4)); y <= Number(range.end.slice(0, 4)); y++) {
    const jan1 = `${y}-01-01`;
    const start = range.start > jan1 ? range.start : jan1;
    const end = range.end < `${y}-12-31` ? range.end : `${y}-12-31`;
    const opts = { year: y, otherIncomeMinor: settings.otherIncomeAnnualMinor, structure: settings.businessStructure };
    const through = (day: string) => (day < jan1 ? 0 : moneyFigures({ revenue, expenses, settings, range: { start: jan1, end: day } }).taxableProfitMinor);
    const after = estimateIncomeTax(through(end), opts);
    const before = start > jan1 ? estimateIncomeTax(through(addDays(start, -1)), opts).totalMinor : 0;
    minor += after.totalMinor - before;
    ratesExact = ratesExact && after.ratesExact;
  }
  return { minor: Math.max(0, minor), ratesExact };
}

// ---------------------------------------------------------------------------
// One ledger of money in and out

export type LedgerKind = "in" | "refund" | "out" | "tax";
export type LedgerFlag = "needs_review" | "no_receipt" | "uncategorized" | "personal" | "no_gst" | "tax_estimated" | "foreign";

export type LedgerEntry = {
  id: string;
  date: string;
  kind: LedgerKind;
  /** Client or vendor. */
  who: string;
  /** The service, or the expense's category. */
  what: string;
  detail: string | null;
  /** Service key (money in) or category key (money out); "tax" for CRA payments. */
  group: string;
  method: string | null;
  /** Signed: money in positive, money out negative. Taxes included (what moved). */
  amountMinor: number;
  /** The GST/HST inside it (signed the same way); ITC for an expense. */
  taxMinor: number;
  /** Before GST/HST (sales for money in, business cost for money out). */
  netMinor: number;
  currency: string;
  flags: LedgerFlag[];
  reference: string | null;
  revenue?: RevenueRow;
  expense?: ExpenseRow;
  taxPayment?: TaxPaymentRow;
};

export function ledgerEntries(input: { revenue: RevenueRow[]; expenses: ExpenseRow[]; taxPayments: TaxPaymentRow[]; settings: TaxSettings; range: Range }): LedgerEntry[] {
  const { range, settings } = input;
  const reg = settings.gstRegistered;
  const out: LedgerEntry[] = [];
  for (const r of input.revenue) {
    if (!inRange(r.date, range)) continue;
    const refund = r.kind === "refund";
    const sign = refund ? -1 : 1;
    const flags: LedgerFlag[] = [];
    if (reg && !refund && r.taxMinor === 0 && missingTaxReason(r)) flags.push("no_gst");
    if (r.taxEstimated) flags.push("tax_estimated");
    if (r.currency !== "CAD") flags.push("foreign");
    const service = serviceOf(r);
    out.push({
      id: `in:${r.id}`,
      date: r.date,
      kind: refund ? "refund" : "in",
      who: r.clientName ?? (r.source === "membership" ? "Member" : r.source === "other" ? "Other income" : "Client"),
      what: refund ? `Refund · ${SERVICE_LABEL[service]}` : SERVICE_LABEL[service],
      detail: r.product,
      group: service,
      method: r.method,
      amountMinor: sign * r.grossMinor,
      taxMinor: sign * (reg ? r.taxMinor : 0),
      netMinor: revenueNetMinor(r),
      currency: r.currency,
      flags,
      reference: r.reference,
      revenue: r,
    });
  }
  for (const e of input.expenses) {
    if (!inRange(e.expense_date, range)) continue;
    const entry = toExpenseEntry(e);
    const cat = expenseCategory(e.category);
    const v = expenseTaxView(entry, reg);
    const flags: LedgerFlag[] = [];
    if (e.status === "needs_review") flags.push("needs_review");
    if (e.category === "uncategorized") flags.push("uncategorized");
    if (!e.receipt_path && e.source !== "stripe_fees" && cat.kind !== "excluded") flags.push("no_receipt");
    if (cat.kind === "excluded") flags.push("personal");
    if (e.currency.toUpperCase() !== "CAD") flags.push("foreign");
    out.push({
      id: `out:${e.id}`,
      date: e.expense_date,
      kind: "out",
      who: e.vendor || e.description || "Expense",
      what: cat.label,
      detail: e.vendor ? e.description : null,
      group: cat.key,
      method: e.payment_method,
      amountMinor: -Number(e.amount_minor),
      taxMinor: -v.itcMinor,
      netMinor: -v.businessCostMinor,
      currency: e.currency,
      flags,
      reference: null,
      expense: e,
    });
  }
  for (const p of input.taxPayments) {
    if (!inRange(p.paid_on, range)) continue;
    out.push({
      id: `tax:${p.id}`,
      date: p.paid_on,
      kind: "tax",
      who: "Canada Revenue Agency",
      what: p.kind === "gst_hst" ? "GST/HST payment" : "Income tax / CPP payment",
      detail: [p.period_label, `for ${p.tax_year}`].filter(Boolean).join(" · "),
      group: "tax",
      method: null,
      amountMinor: -Number(p.amount_minor),
      taxMinor: 0,
      netMinor: 0,
      currency: "CAD",
      flags: [],
      reference: p.reference,
      taxPayment: p,
    });
  }
  // Newest first; on one day money in before money out, then by amount.
  const order: Record<LedgerKind, number> = { in: 0, refund: 1, out: 2, tax: 3 };
  return out.sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind] || Math.abs(b.amountMinor) - Math.abs(a.amountMinor));
}

export type LedgerFilter = {
  type: "all" | "in" | "out";
  /** A service key (money in) or category key (money out). */
  group?: string | null;
  method?: string | null;
  attention?: boolean;
  q?: string;
};

export const NEEDS_ATTENTION: LedgerFlag[] = ["needs_review", "no_receipt", "uncategorized", "no_gst", "foreign"];

export function filterLedger(rows: LedgerEntry[], f: LedgerFilter): LedgerEntry[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.type === "in" && r.kind !== "in" && r.kind !== "refund") return false;
    if (f.type === "out" && r.kind !== "out" && r.kind !== "tax") return false;
    if (f.group && r.group !== f.group) return false;
    if (f.method && (r.method ?? "other").toLowerCase() !== f.method.toLowerCase()) return false;
    if (f.attention && !r.flags.some((x) => NEEDS_ATTENTION.includes(x))) return false;
    if (q) {
      const hay = [r.who, r.what, r.detail, r.reference, methodWord(r.method), r.expense?.notes, r.revenue?.other?.notes].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The totals of what a filtered list shows (in, out, net), so a filter's sum is always the rows'. */
export function ledgerTotals(rows: LedgerEntry[]) {
  const inMinor = sum(rows.filter((r) => r.amountMinor > 0), (r) => r.amountMinor);
  const outMinor = -sum(rows.filter((r) => r.amountMinor < 0), (r) => r.amountMinor);
  return { inMinor, outMinor, netMinor: inMinor - outMinor, count: rows.length };
}

// ---------------------------------------------------------------------------
// Recurring expenses, read from the books (no setup): the same vendor and
// category paid in at least 3 of the last 6 months at about the same amount.
// One that's already set up as a repeating bill (business_recurring_expenses)
// isn't suggested again.

export type RecurringExpense = {
  key: string;
  vendor: string;
  /** The category's label. */
  category: string;
  categoryKey: string;
  /** Typical amount (the median), GST/HST included. */
  minor: number;
  /** The GST/HST on the most recent one. */
  taxMinor: number;
  businessUsePct: number;
  paymentMethod: string | null;
  months: number;
  lastDate: string;
  /** About a month after the last one. */
  nextAbout: string;
  /** Yearly cost at this pace. */
  yearlyMinor: number;
};

/** The key a repeating bill and an expense share: vendor (any case, trimmed) and category. */
export const recurringKey = (vendor: string, category: string) => `${vendor.trim().toLowerCase()}|${category}`;

export function recurringExpenses(expenses: ExpenseRow[], today: string, setUp: Array<Pick<RecurringExpenseRow, "vendor" | "category" | "active">> = []): RecurringExpense[] {
  const from = addDays(today, -186);
  const taken = new Set(setUp.filter((t) => t.active).map((t) => recurringKey(t.vendor, t.category)));
  const groups = new Map<string, ExpenseRow[]>();
  for (const e of expenses) {
    if (e.source === "stripe_fees" || e.source === "recurring" || e.expense_date < from || !e.vendor) continue;
    if (expenseCategory(e.category).kind === "excluded") continue;
    const key = recurringKey(e.vendor, e.category);
    if (taken.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: RecurringExpense[] = [];
  for (const [key, rows] of groups) {
    const months = new Set(rows.map((r) => r.expense_date.slice(0, 7)));
    if (months.size < 3) continue;
    const amounts = rows.map((r) => Number(r.amount_minor)).sort((a, b) => a - b);
    const median = amounts[Math.floor((amounts.length - 1) / 2)];
    if (!median || amounts.some((a) => Math.abs(a - median) > median * 0.3)) continue;
    const latest = [...rows].sort((a, b) => a.expense_date.localeCompare(b.expense_date)).at(-1)!;
    out.push({
      key,
      vendor: latest.vendor!.trim(),
      category: expenseCategory(latest.category).label,
      categoryKey: latest.category,
      minor: median,
      taxMinor: Number(latest.tax_minor) || 0,
      businessUsePct: Number(latest.business_use_pct ?? 100),
      paymentMethod: latest.payment_method ?? null,
      months: months.size,
      lastDate: latest.expense_date,
      nextAbout: addDays(latest.expense_date, 30),
      yearlyMinor: median * 12,
    });
  }
  return out.sort((a, b) => b.minor - a.minor);
}

/** The first day anything is in the books (money in or out), or null for empty books. */
export function booksFirstDay(revenue: Array<Pick<RevenueEntry, "date">>, expenses: Array<Pick<ExpenseEntry, "date">>): string | null {
  let first: string | null = null;
  for (const r of revenue) if (!first || r.date < first) first = r.date;
  for (const e of expenses) if (!first || e.date < first) first = e.date;
  return first;
}

/** Months with money in a range, for an empty-state check. */
export function hasActivity(revenue: RevenueEntry[], expenses: ExpenseEntry[], range: Range): boolean {
  return revenue.some((r) => inRange(r.date, range)) || expenses.some((e) => inRange(e.date, range));
}

export { monthsBetween };
