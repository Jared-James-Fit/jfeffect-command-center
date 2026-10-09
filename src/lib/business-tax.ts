/**
 * business-tax.ts
 *
 * The numbers behind Taxes & Books and Cleo. Pure functions only, so
 * the dashboard, the PDFs and the assistant all read the same figures.
 *
 * Money is integer cents throughout. Revenue is counted when it is received
 * (payment_ledger), GST/HST collected is what Stripe or the manual entry
 * recorded, and ITCs come from the GST/HST on expense receipts.
 *
 * Income tax, CPP and corporate tax are ESTIMATES built from published 2026
 * federal and Manitoba rates. They are meant for setting money aside and for
 * the accountant conversation, not for filing.
 */
import { EXPENSE_CATEGORIES, expenseCategory } from "@/lib/business-expense-categories";

export type RevenueEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  kind: "payment" | "refund";
  /** Tax-included amount, always positive (refunds are positive too). */
  grossMinor: number;
  /** GST/HST inside grossMinor. */
  taxMinor: number;
  /** True when the GST/HST on a refund was derived pro rata from the original. */
  taxEstimated?: boolean;
  method: string | null;
  source: "client" | "membership";
  clientName: string | null;
  product: string | null;
  currency: string;
  stripe: boolean;
};

export type ExpenseEntry = {
  id: string;
  date: string;
  vendor: string | null;
  description: string | null;
  category: string;
  amountMinor: number;
  taxMinor: number;
  businessUsePct: number;
  currency: string;
  hasReceipt: boolean;
  status: "needs_review" | "reviewed";
  source: "manual" | "receipt" | "stripe_fees";
};

export type TaxPaymentEntry = {
  id: string;
  paidOn: string;
  kind: "gst_hst" | "income_tax";
  taxYear: number;
  amountMinor: number;
  periodLabel: string | null;
};

export type GstFrequency = "monthly" | "quarterly" | "annual";

export type TaxSettings = {
  businessName: string;
  province: string;
  businessStructure: "sole_proprietor" | "corporation";
  gstRegistered: boolean;
  gstNumber: string | null;
  gstFilingFrequency: GstFrequency;
  otherIncomeAnnualMinor: number;
  accountantName: string | null;
  stripeFeesSyncedAt: string | null;
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  businessName: "Jared James Fit",
  province: "MB",
  businessStructure: "sole_proprietor",
  gstRegistered: true,
  gstNumber: null,
  gstFilingFrequency: "annual",
  otherIncomeAnnualMinor: 0,
  accountantName: null,
  stripeFeesSyncedAt: null,
};

// ---------------------------------------------------------------------------
// Rates (dollars). 2026: federal brackets indexed 2.0%, lowest rate 14%;
// Manitoba brackets and basic personal amount frozen at 2024 levels.

type Bracket = [upTo: number, rate: number];

type TaxTable = {
  year: number;
  federal: { brackets: Bracket[]; bpaMax: number; bpaMin: number; bpaPhaseStart: number; bpaPhaseEnd: number; creditRate: number };
  manitoba: { brackets: Bracket[]; bpa: number; creditRate: number };
  cpp: { ympe: number; yampe: number; exemption: number; rate: number; employeeBaseRate: number; cpp2Rate: number };
  corporate: { smallBusinessLimit: number; smallRate: number; generalRate: number };
};

const TAX_TABLES: TaxTable[] = [
  {
    year: 2026,
    federal: {
      brackets: [[58523, 0.14], [117045, 0.205], [181440, 0.26], [258482, 0.29], [Infinity, 0.33]],
      bpaMax: 16452,
      bpaMin: 14829,
      bpaPhaseStart: 181440,
      bpaPhaseEnd: 258482,
      creditRate: 0.14,
    },
    manitoba: { brackets: [[47000, 0.108], [100000, 0.1275], [Infinity, 0.174]], bpa: 15780, creditRate: 0.108 },
    cpp: { ympe: 74600, yampe: 85000, exemption: 3500, rate: 0.119, employeeBaseRate: 0.0495, cpp2Rate: 0.08 },
    // Federal 9% + Manitoba 0% on the first $500k of active business income;
    // 15% + 12% above it.
    corporate: { smallBusinessLimit: 500000, smallRate: 0.09, generalRate: 0.27 },
  },
];

export function taxTableFor(year: number): { table: TaxTable; exact: boolean } {
  const exact = TAX_TABLES.find((t) => t.year === year);
  if (exact) return { table: exact, exact: true };
  const sorted = [...TAX_TABLES].sort((a, b) => a.year - b.year);
  const fallback = [...sorted].reverse().find((t) => t.year < year) ?? sorted[0];
  return { table: fallback, exact: false };
}

/** GST Quick Method remittance rate for services supplied in a GST-only province. */
export const QUICK_METHOD_SERVICE_RATE = 0.036;
const QUICK_METHOD_CREDIT_RATE = 0.01;
const QUICK_METHOD_CREDIT_LIMIT_MINOR = 30_000_00;
/** Net tax above this in the year means CRA will usually want instalments next year. */
export const INSTALMENT_THRESHOLD_MINOR = 3_000_00;

// ---------------------------------------------------------------------------
// Small helpers

const round = (n: number) => Math.round(n);

function progressive(income: number, brackets: Bracket[]): number {
  let tax = 0;
  let floor = 0;
  for (const [upTo, rate] of brackets) {
    if (income <= floor) break;
    tax += (Math.min(income, upTo) - floor) * rate;
    floor = upTo;
  }
  return tax;
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
}

function dayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Tax-excluded amount of a revenue row, signed (refunds negative). */
export function revenueNetMinor(r: RevenueEntry): number {
  const net = r.grossMinor - r.taxMinor;
  return r.kind === "refund" ? -net : net;
}

function revenueTaxSigned(r: RevenueEntry): number {
  return r.kind === "refund" ? -r.taxMinor : r.taxMinor;
}

// ---------------------------------------------------------------------------
// Expenses

export type ExpenseTaxView = {
  /** Deductible this year (operating expenses; capital items show CCA instead). */
  deductibleMinor: number;
  /** First-year CCA for capital items. */
  ccaMinor: number;
  /** GST/HST that can be claimed back as an input tax credit. */
  itcMinor: number;
  /** Pre-tax cost, business-use share. */
  businessCostMinor: number;
};

export function expenseTaxView(e: ExpenseEntry, gstRegistered = true): ExpenseTaxView {
  const cat = expenseCategory(e.category);
  const use = Math.min(100, Math.max(0, e.businessUsePct)) / 100;
  if (cat.kind === "excluded") return { deductibleMinor: 0, ccaMinor: 0, itcMinor: 0, businessCostMinor: 0 };
  const itcMinor = gstRegistered ? round(e.taxMinor * use * cat.itcPct) : 0;
  // A GST registrant claims the tax back as an ITC, so it is not also a cost.
  // Without registration the tax is part of the cost.
  const preTax = gstRegistered ? e.amountMinor - e.taxMinor : e.amountMinor;
  const businessCostMinor = round(preTax * use);
  if (cat.kind === "capital") {
    return { deductibleMinor: 0, ccaMinor: round(businessCostMinor * (cat.ccaRate ?? 0)), itcMinor, businessCostMinor };
  }
  return { deductibleMinor: round(businessCostMinor * cat.deductiblePct), ccaMinor: 0, itcMinor, businessCostMinor };
}

// ---------------------------------------------------------------------------
// Income tax and CPP (sole proprietor), and corporate tax

export type CppEstimate = {
  pensionableMinor: number;
  baseMinor: number;
  cpp2Minor: number;
  totalMinor: number;
  /** Employee base share: claimed as a non-refundable credit. */
  creditBaseMinor: number;
  /** Everything else: deducted from income (line 22200). */
  deductionMinor: number;
};

export function estimateCpp(selfEmployedEarningsMinor: number, year: number): CppEstimate {
  const { cpp } = taxTableFor(year).table;
  const earnings = Math.max(0, selfEmployedEarningsMinor) / 100;
  const pensionable = Math.max(0, Math.min(earnings, cpp.ympe) - cpp.exemption);
  const base = pensionable * cpp.rate;
  const cpp2 = Math.max(0, Math.min(earnings, cpp.yampe) - cpp.ympe) * cpp.cpp2Rate;
  const creditBase = pensionable * cpp.employeeBaseRate;
  return {
    pensionableMinor: round(pensionable * 100),
    baseMinor: round(base * 100),
    cpp2Minor: round(cpp2 * 100),
    totalMinor: round((base + cpp2) * 100),
    creditBaseMinor: round(creditBase * 100),
    deductionMinor: round((base + cpp2 - creditBase) * 100),
  };
}

function personalIncomeTax(taxableDollars: number, netIncomeDollars: number, cppCreditBaseDollars: number, year: number) {
  const { federal, manitoba } = taxTableFor(year).table;
  let bpa = federal.bpaMax;
  if (netIncomeDollars > federal.bpaPhaseStart) {
    const span = federal.bpaPhaseEnd - federal.bpaPhaseStart;
    const over = Math.min(span, netIncomeDollars - federal.bpaPhaseStart);
    bpa = federal.bpaMax - ((federal.bpaMax - federal.bpaMin) * over) / span;
  }
  const fed = Math.max(0, progressive(taxableDollars, federal.brackets) - federal.creditRate * (bpa + cppCreditBaseDollars));
  const prov = Math.max(0, progressive(taxableDollars, manitoba.brackets) - manitoba.creditRate * (manitoba.bpa + cppCreditBaseDollars));
  return { federal: fed, provincial: prov };
}

export type IncomeTaxEstimate = {
  structure: "sole_proprietor" | "corporation";
  netBusinessIncomeMinor: number;
  taxableIncomeMinor: number;
  federalTaxMinor: number;
  provincialTaxMinor: number;
  cpp: CppEstimate;
  /** Income tax caused by the business (on top of tax on other income). */
  incomeTaxOnBusinessMinor: number;
  /** incomeTaxOnBusiness + CPP (sole prop) or corporate tax. */
  totalMinor: number;
  /** Share of the next business dollar that goes to income tax + CPP. */
  marginalRate: number;
  effectiveRate: number;
  ratesYear: number;
  ratesExact: boolean;
};

function soleProprietorTotal(netBusinessMinor: number, otherIncomeMinor: number, year: number) {
  const cpp = estimateCpp(netBusinessMinor, year);
  const business = netBusinessMinor / 100;
  const other = otherIncomeMinor / 100;
  const netIncome = Math.max(0, other + business - cpp.deductionMinor / 100);
  const withBusiness = personalIncomeTax(netIncome, netIncome, cpp.creditBaseMinor / 100, year);
  const baseline = personalIncomeTax(Math.max(0, other), Math.max(0, other), 0, year);
  const incomeTax = Math.max(0, withBusiness.federal + withBusiness.provincial - baseline.federal - baseline.provincial);
  return { cpp, netIncome, withBusiness, incomeTax, total: incomeTax + cpp.totalMinor / 100 };
}

function corporateTax(netBusinessMinor: number, year: number): number {
  const { corporate } = taxTableFor(year).table;
  const income = Math.max(0, netBusinessMinor) / 100;
  const small = Math.min(income, corporate.smallBusinessLimit);
  return small * corporate.smallRate + Math.max(0, income - corporate.smallBusinessLimit) * corporate.generalRate;
}

export function estimateIncomeTax(
  netBusinessIncomeMinor: number,
  opts: { year: number; otherIncomeMinor?: number; structure?: "sole_proprietor" | "corporation" },
): IncomeTaxEstimate {
  const { table, exact } = taxTableFor(opts.year);
  const structure = opts.structure ?? "sole_proprietor";
  const other = Math.max(0, opts.otherIncomeMinor ?? 0);
  const net = netBusinessIncomeMinor;

  if (structure === "corporation") {
    const tax = corporateTax(net, opts.year);
    const marginal = (corporateTax(net + 100_000, opts.year) - tax) / 1000;
    const zeroCpp = estimateCpp(0, opts.year);
    return {
      structure,
      netBusinessIncomeMinor: net,
      taxableIncomeMinor: Math.max(0, net),
      federalTaxMinor: round(tax * 100),
      provincialTaxMinor: 0,
      cpp: zeroCpp,
      incomeTaxOnBusinessMinor: round(tax * 100),
      totalMinor: round(tax * 100),
      marginalRate: marginal,
      effectiveRate: net > 0 ? (tax * 100) / net : 0,
      ratesYear: table.year,
      ratesExact: exact,
    };
  }

  const now = soleProprietorTotal(Math.max(0, net), other, opts.year);
  const next = soleProprietorTotal(Math.max(0, net) + 100_000, other, opts.year);
  const totalMinor = round(now.total * 100);
  return {
    structure,
    netBusinessIncomeMinor: net,
    taxableIncomeMinor: round(now.netIncome * 100),
    federalTaxMinor: round(now.withBusiness.federal * 100),
    provincialTaxMinor: round(now.withBusiness.provincial * 100),
    cpp: now.cpp,
    incomeTaxOnBusinessMinor: round(now.incomeTax * 100),
    totalMinor,
    marginalRate: (next.total - now.total) / 1000,
    effectiveRate: net > 0 ? totalMinor / net : 0,
    ratesYear: table.year,
    ratesExact: exact,
  };
}

// ---------------------------------------------------------------------------
// GST/HST periods and deadlines

export type GstPeriod = {
  key: string;
  label: string;
  start: string;
  end: string;
  /** Line 101: sales, tax excluded. */
  salesMinor: number;
  /** Line 103: GST/HST collected. */
  collectedMinor: number;
  /** Line 106: input tax credits. */
  itcMinor: number;
  /** Line 109: net tax. */
  netTaxMinor: number;
  filingDue: string;
  paymentDue: string;
  closed: boolean;
};

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function lastDayOfMonth(year: number, month1: number): string {
  return new Date(Date.UTC(year, month1, 0)).toISOString().slice(0, 10);
}

function periodRanges(year: number, freq: GstFrequency): Array<{ key: string; label: string; start: string; end: string; due: string; payDue: string }> {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (freq === "annual") {
    // Individuals with business income and a Dec 31 year end: file by June 15,
    // pay by April 30.
    return [{ key: `${year}`, label: `${year} (annual)`, start: `${year}-01-01`, end: `${year}-12-31`, due: `${year + 1}-06-15`, payDue: `${year + 1}-04-30` }];
  }
  const months = freq === "monthly" ? 1 : 3;
  const out = [];
  for (let m = 1; m <= 12; m += months) {
    const endMonth = m + months - 1;
    const end = lastDayOfMonth(year, endMonth);
    const dueMonth = endMonth + 1;
    const dueYear = dueMonth > 12 ? year + 1 : year;
    const due = lastDayOfMonth(dueYear, ((dueMonth - 1) % 12) + 1);
    const label = freq === "monthly"
      ? `${MONTH_NAMES[m - 1]} ${year}`
      : `Q${(m + 2) / 3} (${MONTH_NAMES[m - 1].slice(0, 3)}-${MONTH_NAMES[endMonth - 1].slice(0, 3)})`;
    out.push({ key: `${year}-${pad(m)}`, label, start: `${year}-${pad(m)}-01`, end, due, payDue: due });
  }
  return out;
}

export type Deadline = { date: string; title: string; detail: string; kind: "gst" | "income_tax" | "instalment" };

// ---------------------------------------------------------------------------
// The snapshot

export type ReadinessIssue = {
  id: string;
  severity: "warn" | "info";
  title: string;
  detail: string;
  count?: number;
  amountMinor?: number;
};

export type Tip = { id: string; title: string; detail: string; savingsMinor?: number };

export type MonthRow = {
  month: string; // YYYY-MM
  salesMinor: number;
  collectedMinor: number;
  expensesMinor: number;
  itcMinor: number;
  profitMinor: number;
};

export type CategoryRow = {
  key: string;
  label: string;
  t2125Line: string | null;
  t2125Label: string | null;
  count: number;
  totalMinor: number;
  deductibleMinor: number;
  ccaMinor: number;
  itcMinor: number;
};

export type T2125Line = { line: string; label: string; amountMinor: number };

export type BooksSnapshot = {
  year: number;
  asOf: string;
  /** False when looking at a past year (everything is final). */
  inProgress: boolean;
  settings: TaxSettings;
  revenue: {
    grossMinor: number;
    refundsMinor: number;
    salesMinor: number; // tax excluded, net of refunds (line 101)
    collectedMinor: number; // GST/HST collected net of refunds (line 103)
    paymentCount: number;
    refundCount: number;
    byMethod: Array<{ method: string; salesMinor: number; count: number }>;
    byProduct: Array<{ product: string; salesMinor: number; count: number }>;
    byClient: Array<{ client: string; salesMinor: number; count: number }>;
  };
  expenses: {
    totalMinor: number;
    deductibleMinor: number;
    ccaMinor: number;
    itcMinor: number;
    excludedMinor: number;
    count: number;
    byCategory: CategoryRow[];
  };
  profitMinor: number; // sales - deductible - CCA
  months: MonthRow[];
  gst: {
    registered: boolean;
    frequency: GstFrequency;
    periods: GstPeriod[];
    netTaxMinor: number;
    paidMinor: number;
    owingMinor: number;
    quickMethod: { eligibleSalesGrossMinor: number; remitMinor: number; regularMinor: number; savingsMinor: number } | null;
  };
  incomeTax: {
    ytd: IncomeTaxEstimate;
    projected: IncomeTaxEstimate;
    paidMinor: number;
    owingNowMinor: number;
    owingProjectedMinor: number;
  };
  projection: {
    salesMinor: number;
    expensesMinor: number;
    profitMinor: number;
    basis: string;
  };
  /** GST/HST owing + income tax/CPP owing so far, net of payments. */
  setAsideNowMinor: number;
  /** Of each tax-excluded dollar received from now on, the share to put aside for income tax + CPP. */
  setAsideRate: number;
  t2125: T2125Line[];
  deadlines: Deadline[];
  issues: ReadinessIssue[];
  tips: Tip[];
};

function sumBy<T>(rows: T[], f: (r: T) => number): number {
  let s = 0;
  for (const r of rows) s += f(r);
  return s;
}

function groupTop<T>(rows: T[], key: (r: T) => string, value: (r: T) => number, limit = 15) {
  const map = new Map<string, { value: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = map.get(k) ?? { value: 0, count: 0 };
    cur.value += value(r);
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function inRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

/** GST/HST rate a revenue row was charged at (0.05 GST, 0.13/0.15 HST). */
function impliedRate(r: RevenueEntry): number {
  const net = r.grossMinor - r.taxMinor;
  return net > 0 ? r.taxMinor / net : 0;
}

export function buildBooksSnapshot(input: {
  year: number;
  asOf: string;
  settings: TaxSettings;
  revenue: RevenueEntry[];
  expenses: ExpenseEntry[];
  taxPayments: TaxPaymentEntry[];
}): BooksSnapshot {
  const { year, settings } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const asOf = input.asOf > yearEnd ? yearEnd : input.asOf;
  const inProgress = input.asOf <= yearEnd;
  const gstRegistered = settings.gstRegistered;

  const revenue = input.revenue.filter((r) => inRange(r.date, yearStart, yearEnd));
  const expenses = input.expenses.filter((e) => inRange(e.date, yearStart, yearEnd));
  const payments = input.taxPayments.filter((p) => p.taxYear === year);

  // Revenue ------------------------------------------------------------------
  const paymentsIn = revenue.filter((r) => r.kind === "payment");
  const refunds = revenue.filter((r) => r.kind === "refund");
  const salesMinor = sumBy(revenue, revenueNetMinor);
  const collectedMinor = gstRegistered ? sumBy(revenue, revenueTaxSigned) : 0;

  // Expenses -----------------------------------------------------------------
  const views = expenses.map((e) => ({ e, v: expenseTaxView(e, gstRegistered), cat: expenseCategory(e.category) }));
  const deductibleMinor = sumBy(views, (x) => x.v.deductibleMinor);
  const ccaMinor = sumBy(views, (x) => x.v.ccaMinor);
  const itcMinor = sumBy(views, (x) => x.v.itcMinor);
  const excludedMinor = sumBy(views.filter((x) => x.cat.kind === "excluded"), (x) => x.e.amountMinor);

  const byCategory: CategoryRow[] = EXPENSE_CATEGORIES.map((cat) => {
    const rows = views.filter((x) => x.cat.key === cat.key);
    return {
      key: cat.key,
      label: cat.label,
      t2125Line: cat.t2125Line,
      t2125Label: cat.t2125Label,
      count: rows.length,
      totalMinor: sumBy(rows, (x) => x.e.amountMinor),
      deductibleMinor: sumBy(rows, (x) => x.v.deductibleMinor),
      ccaMinor: sumBy(rows, (x) => x.v.ccaMinor),
      itcMinor: sumBy(rows, (x) => x.v.itcMinor),
    };
  }).filter((c) => c.count > 0).sort((a, b) => b.deductibleMinor + b.ccaMinor - (a.deductibleMinor + a.ccaMinor));

  const profitMinor = salesMinor - deductibleMinor - ccaMinor;

  // Months -------------------------------------------------------------------
  const months: MonthRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    const rev = revenue.filter((r) => r.date.startsWith(key));
    const exp = views.filter((x) => x.e.date.startsWith(key));
    const sales = sumBy(rev, revenueNetMinor);
    const exps = sumBy(exp, (x) => x.v.deductibleMinor + x.v.ccaMinor);
    months.push({
      month: key,
      salesMinor: sales,
      collectedMinor: gstRegistered ? sumBy(rev, revenueTaxSigned) : 0,
      expensesMinor: exps,
      itcMinor: sumBy(exp, (x) => x.v.itcMinor),
      profitMinor: sales - exps,
    });
  }

  // GST/HST ------------------------------------------------------------------
  const periods: GstPeriod[] = gstRegistered
    ? periodRanges(year, settings.gstFilingFrequency).map((p) => {
        const rev = revenue.filter((r) => inRange(r.date, p.start, p.end));
        const exp = views.filter((x) => inRange(x.e.date, p.start, p.end));
        const collected = sumBy(rev, revenueTaxSigned);
        const itc = sumBy(exp, (x) => x.v.itcMinor);
        return {
          key: p.key,
          label: p.label,
          start: p.start,
          end: p.end,
          salesMinor: sumBy(rev, revenueNetMinor),
          collectedMinor: collected,
          itcMinor: itc,
          netTaxMinor: collected - itc,
          filingDue: p.due,
          paymentDue: p.payDue,
          closed: input.asOf > p.end,
        };
      })
    : [];
  const gstNet = collectedMinor - itcMinor;
  const gstPaid = sumBy(payments.filter((p) => p.kind === "gst_hst"), (p) => p.amountMinor);

  // Quick Method comparison: GST-only (5%) sales, services rate. HST sales and
  // capital ITCs are left out, so it only says "worth asking about".
  let quickMethod: BooksSnapshot["gst"]["quickMethod"] = null;
  if (gstRegistered) {
    const gstOnly = revenue.filter((r) => Math.abs(impliedRate(r) - 0.05) < 0.006);
    const gross = sumBy(gstOnly, (r) => (r.kind === "refund" ? -r.grossMinor : r.grossMinor));
    if (gross > 0) {
      const regular = sumBy(gstOnly, revenueTaxSigned) - sumBy(views.filter((x) => x.cat.kind !== "capital"), (x) => x.v.itcMinor);
      const capitalItc = sumBy(views.filter((x) => x.cat.kind === "capital"), (x) => x.v.itcMinor);
      const remit = round(gross * QUICK_METHOD_SERVICE_RATE - Math.min(gross, QUICK_METHOD_CREDIT_LIMIT_MINOR) * QUICK_METHOD_CREDIT_RATE) - capitalItc;
      quickMethod = { eligibleSalesGrossMinor: gross, remitMinor: remit, regularMinor: regular - capitalItc, savingsMinor: regular - capitalItc - remit };
    }
  }

  // Projection ---------------------------------------------------------------
  // Year to date plus the recent pace (last 90 days, or since the first
  // activity this year if that is shorter) for the rest of the year.
  const firstActivity = [...revenue.map((r) => r.date), ...expenses.map((e) => e.date)].sort()[0] ?? asOf;
  const elapsedDays = dayIndex(asOf) + 1;
  const remainingDays = inProgress ? daysInYear(year) - elapsedDays : 0;
  const windowStart = [addDays(asOf, -89), firstActivity, yearStart].sort().reverse()[0];
  const windowDays = Math.max(1, dayIndex(asOf) - dayIndex(windowStart) + 1);
  // A prepaid annual package or a big one-off would otherwise be projected as
  // if it repeats. Payments over 5x the typical (median) payment in the
  // window are counted once, not extrapolated.
  const winRevenue = revenue.filter((r) => inRange(r.date, windowStart, asOf));
  const winPayments = winRevenue.filter((r) => r.kind === "payment").map(revenueNetMinor).sort((a, b) => a - b);
  const median = winPayments.length ? winPayments[Math.floor((winPayments.length - 1) / 2)] : 0;
  const oneOffLimit = median * 5;
  const oneOffs = winPayments.length >= 3 ? winRevenue.filter((r) => r.kind === "payment" && revenueNetMinor(r) > oneOffLimit) : [];
  const winSales = sumBy(winRevenue, revenueNetMinor) - sumBy(oneOffs, revenueNetMinor);
  const winExp = sumBy(views.filter((x) => inRange(x.e.date, windowStart, asOf) && x.cat.kind === "expense"), (x) => x.v.deductibleMinor);
  const projSales = salesMinor + round((winSales / windowDays) * remainingDays);
  const projExp = deductibleMinor + ccaMinor + round((winExp / windowDays) * remainingDays);
  const projection = {
    salesMinor: projSales,
    expensesMinor: projExp,
    profitMinor: projSales - projExp,
    basis: !inProgress
      ? "Final: the year is over."
      : remainingDays === 0
        ? "Year to date."
        : `Year to date plus the pace of the last ${windowDays} days for the remaining ${remainingDays} days` +
          (oneOffs.length ? `, not repeating ${oneOffs.length} one-off payment${oneOffs.length === 1 ? "" : "s"} over ${fmtCad(oneOffLimit)}.` : "."),
  };

  // Income tax ---------------------------------------------------------------
  const taxOpts = { year, otherIncomeMinor: settings.otherIncomeAnnualMinor, structure: settings.businessStructure };
  const ytd = estimateIncomeTax(profitMinor, taxOpts);
  const projected = estimateIncomeTax(projection.profitMinor, taxOpts);
  const incomeTaxPaid = sumBy(payments.filter((p) => p.kind === "income_tax"), (p) => p.amountMinor);
  const owingNow = ytd.totalMinor - incomeTaxPaid;
  const owingProjected = projected.totalMinor - incomeTaxPaid;
  const gstOwing = gstRegistered ? gstNet - gstPaid : 0;

  // T2125 summary -------------------------------------------------------------
  const lineMap = new Map<string, T2125Line>();
  for (const c of byCategory) {
    if (!c.t2125Line) continue;
    const amount = c.deductibleMinor + c.ccaMinor;
    const cur = lineMap.get(c.t2125Line) ?? { line: c.t2125Line, label: c.t2125Label ?? c.label, amountMinor: 0 };
    cur.amountMinor += amount;
    lineMap.set(c.t2125Line, cur);
  }
  const t2125: T2125Line[] = [
    { line: "8000", label: "Adjusted gross sales (GST/HST excluded)", amountMinor: salesMinor },
    ...[...lineMap.values()].sort((a, b) => a.line.localeCompare(b.line)),
    { line: "9369", label: "Net income (loss) before adjustments", amountMinor: profitMinor },
  ];

  // Deadlines -----------------------------------------------------------------
  const deadlines: Deadline[] = [];
  if (gstRegistered) {
    for (const p of periods) {
      if (settings.gstFilingFrequency === "annual") {
        deadlines.push({ date: p.paymentDue, title: `Pay GST/HST for ${year}`, detail: "Annual filer: payment is due April 30 even though the return is due June 15.", kind: "gst" });
        deadlines.push({ date: p.filingDue, title: `File GST/HST return for ${year}`, detail: "Lines 101, 103, 106 and 109 are in the GST/HST worksheet.", kind: "gst" });
      } else {
        deadlines.push({ date: p.filingDue, title: `File and pay GST/HST: ${p.label}`, detail: `Period ${p.start} to ${p.end}.`, kind: "gst" });
      }
    }
  }
  if (settings.businessStructure === "sole_proprietor") {
    deadlines.push({ date: `${year + 1}-04-30`, title: `Pay ${year} income tax and CPP balance`, detail: "Self-employed: payment is due April 30 even though the return is due June 15. Interest runs from May 1.", kind: "income_tax" });
    deadlines.push({ date: `${year + 1}-06-15`, title: `File ${year} personal return (T1 + T2125)`, detail: "Self-employed filing deadline.", kind: "income_tax" });
    if (projected.totalMinor > INSTALMENT_THRESHOLD_MINOR) {
      for (const md of ["03-15", "06-15", "09-15", "12-15"]) {
        deadlines.push({ date: `${year + 1}-${md}`, title: `Likely income tax instalment (${year + 1})`, detail: `Projected ${year} tax is over $3,000, so CRA will usually send instalment reminders for ${year + 1}.`, kind: "instalment" });
      }
    }
  } else {
    deadlines.push({ date: `${year + 1}-03-31`, title: `Pay ${year} corporate tax balance`, detail: "CCPC claiming the small business deduction: due 3 months after year end (Dec 31 year end assumed).", kind: "income_tax" });
    deadlines.push({ date: `${year + 1}-06-30`, title: `File ${year} T2 corporate return`, detail: "Due 6 months after year end.", kind: "income_tax" });
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date));

  // Readiness -----------------------------------------------------------------
  const issues: ReadinessIssue[] = [];
  const needsReview = expenses.filter((e) => e.status === "needs_review");
  if (needsReview.length) {
    issues.push({ id: "needs-review", severity: "warn", title: `${needsReview.length} receipt${needsReview.length === 1 ? "" : "s"} to confirm`, detail: "Cleo filed these but was not sure about something. Check the amount, GST and category.", count: needsReview.length, amountMinor: sumBy(needsReview, (e) => e.amountMinor) });
  }
  const uncategorized = expenses.filter((e) => e.category === "uncategorized");
  if (uncategorized.length) {
    issues.push({ id: "uncategorized", severity: "warn", title: `${uncategorized.length} uncategorized expense${uncategorized.length === 1 ? "" : "s"}`, detail: "They count as Other expenses until you pick a category.", count: uncategorized.length, amountMinor: sumBy(uncategorized, (e) => e.amountMinor) });
  }
  const noReceipt = expenses.filter((e) => !e.hasReceipt && e.source !== "stripe_fees" && expenseCategory(e.category).kind !== "excluded");
  if (noReceipt.length) {
    issues.push({ id: "no-receipt", severity: "warn", title: `${noReceipt.length} expense${noReceipt.length === 1 ? "" : "s"} without a receipt`, detail: "CRA can ask for receipts for 6 years, and GST can only be claimed back with one. Snap a photo or attach the PDF.", count: noReceipt.length, amountMinor: sumBy(noReceipt, (e) => e.amountMinor) });
  }
  const zeroTax = paymentsIn.filter((r) => r.taxMinor === 0 && r.source === "client");
  if (gstRegistered && zeroTax.length) {
    issues.push({ id: "zero-tax-revenue", severity: "warn", title: `${zeroTax.length} payment${zeroTax.length === 1 ? "" : "s"} with no GST/HST recorded`, detail: "Either tax was not charged (deposit, out-of-country client) or it was missed. Confirm each with your accountant: if GST was owed it is still owed.", count: zeroTax.length, amountMinor: sumBy(zeroTax, (r) => r.grossMinor) });
  }
  const estRefunds = refunds.filter((r) => r.taxEstimated);
  if (estRefunds.length) {
    issues.push({ id: "refund-tax-estimated", severity: "info", title: `GST/HST on ${estRefunds.length} refund${estRefunds.length === 1 ? "" : "s"} estimated`, detail: "The refund did not record its tax, so it was worked out from the original payment's rate.", count: estRefunds.length });
  }
  const membership = paymentsIn.filter((r) => r.source === "membership" && r.taxMinor === 0);
  if (gstRegistered && membership.length) {
    issues.push({ id: "membership-no-tax", severity: "info", title: `${membership.length} membership payment${membership.length === 1 ? "" : "s"} without tax detail`, detail: "Membership payments do not store GST/HST separately; they are counted as tax-free sales.", count: membership.length, amountMinor: sumBy(membership, (r) => r.grossMinor) });
  }
  const foreign = [...revenue.filter((r) => r.currency.toUpperCase() !== "CAD"), ...expenses.filter((e) => e.currency.toUpperCase() !== "CAD")];
  if (foreign.length) {
    issues.push({ id: "foreign-currency", severity: "warn", title: `${foreign.length} non-CAD amount${foreign.length === 1 ? "" : "s"}`, detail: "They are added as if they were CAD. Your accountant converts them at the Bank of Canada rate.", count: foreign.length });
  }
  if (gstRegistered && !settings.gstNumber) {
    issues.push({ id: "gst-number", severity: "info", title: "Add your GST/HST number", detail: "It goes on the year-end package and any receipts you issue. Settings tab.", count: 1 });
  }
  const stripeRevenue = paymentsIn.some((r) => r.stripe);
  const feesSyncedDays = settings.stripeFeesSyncedAt ? (Date.parse(`${input.asOf}T12:00:00Z`) - Date.parse(settings.stripeFeesSyncedAt)) / 86_400_000 : Infinity;
  if (stripeRevenue && feesSyncedDays > 7) {
    issues.push({ id: "stripe-fees", severity: "info", title: "Stripe fees not synced recently", detail: "Stripe processing fees are deductible. Sync them so they land in Bank & payment processing fees.", count: 1 });
  }

  // Tips (only ones the data supports) -----------------------------------------
  const tips: Tip[] = [];
  if (quickMethod && quickMethod.savingsMinor >= 100_00 && quickMethod.eligibleSalesGrossMinor < 400_000_00) {
    tips.push({
      id: "quick-method",
      title: "The GST Quick Method looks cheaper",
      detail: `On this year's GST sales you would remit about ${fmtCad(quickMethod.remitMinor)} instead of ${fmtCad(quickMethod.regularMinor)}. Service businesses under $400k qualify; you elect with form GST74 before the period starts. Worth a question to your accountant.`,
      savingsMinor: quickMethod.savingsMinor,
    });
  }
  const claimed = new Set(expenses.map((e) => e.category));
  if (revenue.length && !claimed.has("phone_internet")) {
    tips.push({ id: "phone", title: "No phone or internet claimed", detail: "If you coach from your phone, the business-use share of the plan and home internet is deductible. Add it with the business-use %." });
  }
  if (revenue.length && !claimed.has("software")) {
    tips.push({ id: "software", title: "No software claimed", detail: "App subscriptions, website hosting, Canva, music licences and similar tools are deductible. Forward the emailed receipts and snap them in." });
  }
  if (projected.totalMinor > INSTALMENT_THRESHOLD_MINOR && settings.businessStructure === "sole_proprietor") {
    tips.push({ id: "instalments", title: "Expect instalments next year", detail: `Projected ${year} income tax and CPP is ${fmtCad(projected.totalMinor)}. Above $3,000, CRA usually asks for quarterly instalments the following year.` });
  }

  const setAsideNowMinor = Math.max(0, gstOwing) + Math.max(0, owingNow);

  return {
    year,
    asOf,
    inProgress,
    settings,
    revenue: {
      grossMinor: sumBy(paymentsIn, (r) => r.grossMinor),
      refundsMinor: sumBy(refunds, (r) => r.grossMinor),
      salesMinor,
      collectedMinor,
      paymentCount: paymentsIn.length,
      refundCount: refunds.length,
      byMethod: groupTop(revenue, (r) => r.method ?? "other", revenueNetMinor).map((g) => ({ method: g.k, salesMinor: g.value, count: g.count })),
      byProduct: groupTop(revenue, (r) => r.product ?? "Payment", revenueNetMinor).map((g) => ({ product: g.k, salesMinor: g.value, count: g.count })),
      byClient: groupTop(revenue, (r) => r.clientName ?? "Unknown", revenueNetMinor).map((g) => ({ client: g.k, salesMinor: g.value, count: g.count })),
    },
    expenses: {
      totalMinor: sumBy(expenses, (e) => e.amountMinor),
      deductibleMinor,
      ccaMinor,
      itcMinor,
      excludedMinor,
      count: expenses.length,
      byCategory,
    },
    profitMinor,
    months,
    gst: {
      registered: gstRegistered,
      frequency: settings.gstFilingFrequency,
      periods,
      netTaxMinor: gstRegistered ? gstNet : 0,
      paidMinor: gstPaid,
      owingMinor: gstOwing,
      quickMethod,
    },
    incomeTax: { ytd, projected, paidMinor: incomeTaxPaid, owingNowMinor: owingNow, owingProjectedMinor: owingProjected },
    projection,
    setAsideNowMinor,
    setAsideRate: Math.max(0, projected.marginalRate),
    t2125,
    deadlines,
    issues,
    tips,
  };
}

export function fmtCad(minor: number): string {
  const v = minor / 100 || 0; // never "-$0.00"
  return v.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
