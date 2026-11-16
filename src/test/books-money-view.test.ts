import { describe, expect, it } from "vitest";
import {
  canStepForward, chartMonths, comparisonFor, customPeriod, decodePeriod, encodePeriod, monthPeriod, periodFor, stepPeriod, yearBefore,
} from "@/lib/books/period";
import {
  changeOf, filterLedger, ledgerEntries, ledgerTotals, moneyFigures, monthlySeries, periodTaxReserve, recurringExpenses, serviceOf,
} from "@/lib/books/money-view";
import { DEFAULT_TAX_SETTINGS, buildBooksSnapshot, estimateIncomeTax, type RevenueEntry } from "@/lib/business-tax";
import { toExpenseEntry, type ExpenseRow, type RevenueRow, type TaxPaymentRow } from "@/lib/business-books";

const TODAY = "2026-11-16";
const settings = { ...DEFAULT_TAX_SETTINGS, gstRegistered: true };

describe("periods", () => {
  it("names the presets the way people say them", () => {
    expect(periodFor("this_month", TODAY)).toMatchObject({ start: "2026-11-01", end: "2026-11-30", label: "November 2026", unit: "month" });
    expect(periodFor("last_month", TODAY)).toMatchObject({ start: "2026-10-01", end: "2026-10-31", label: "October 2026" });
    expect(periodFor("last_30", TODAY)).toMatchObject({ start: "2026-10-18", end: "2026-11-16" });
    expect(periodFor("this_quarter", TODAY)).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026 (Oct – Dec)" });
    expect(periodFor("last_quarter", TODAY)).toMatchObject({ start: "2026-07-01", end: "2026-09-30" });
    expect(periodFor("ytd", TODAY)).toMatchObject({ start: "2026-01-01", end: TODAY, label: "2026 so far" });
    expect(periodFor("last_year", TODAY)).toMatchObject({ start: "2025-01-01", end: "2025-12-31", label: "2025" });
    expect(periodFor("last_quarter", "2026-02-10")).toMatchObject({ start: "2025-10-01", end: "2025-12-31" });
  });

  it("steps a month, a quarter, a year and a range, and never past today", () => {
    const nov = periodFor("this_month", TODAY);
    const oct = stepPeriod(nov, -1, TODAY);
    expect(oct).toMatchObject({ start: "2026-10-01", preset: "last_month" });
    expect(stepPeriod(oct, -1, TODAY)).toMatchObject({ start: "2026-09-01", preset: "month", label: "September 2026" });
    expect(stepPeriod(monthPeriod("2026-01", TODAY), -1, TODAY)).toMatchObject({ start: "2025-12-01", label: "December 2025" });
    expect(stepPeriod(periodFor("this_quarter", TODAY), -1, TODAY)).toMatchObject({ start: "2026-07-01", preset: "last_quarter" });
    expect(stepPeriod(periodFor("ytd", TODAY), -1, TODAY)).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
    expect(stepPeriod(periodFor("last_30", TODAY), -1, TODAY)).toMatchObject({ start: "2026-09-18", end: "2026-10-17" });
    expect(canStepForward(nov, TODAY)).toBe(false);
    expect(canStepForward(oct, TODAY)).toBe(true);
  });

  it("compares a running month with the same days of the month before", () => {
    const nov = periodFor("this_month", TODAY);
    expect(comparisonFor(nov, "previous", TODAY)).toMatchObject({ start: "2026-10-01", end: "2026-10-16", label: "Oct 1 – 16" });
    expect(comparisonFor(nov, "last_year", TODAY)).toMatchObject({ start: "2025-11-01", end: "2025-11-16" });
    expect(comparisonFor(periodFor("last_month", TODAY), "previous", TODAY)).toMatchObject({ start: "2026-09-01", end: "2026-09-30" });
    expect(comparisonFor(periodFor("ytd", TODAY), "previous", TODAY)).toMatchObject({ start: "2025-01-01", end: "2025-11-16" });
    expect(comparisonFor(periodFor("last_30", TODAY), "previous", TODAY)).toMatchObject({ start: "2026-09-18", end: "2026-10-17" });
    expect(comparisonFor(nov, "none", TODAY)).toBeNull();
    // March 31 into a 28-day February: the comparison stays inside February.
    expect(comparisonFor(monthPeriod("2026-03", "2026-03-31"), "previous", "2026-03-31")).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(yearBefore("2028-02-29")).toBe("2027-02-28");
  });

  it("charts one month against the year around it and a long period by its own months", () => {
    expect(chartMonths(periodFor("this_month", TODAY), TODAY)).toEqual(
      ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
    );
    expect(chartMonths(periodFor("ytd", TODAY), TODAY)).toHaveLength(11);
  });

  it("round-trips through the address bar", () => {
    for (const p of [periodFor("this_month", TODAY), monthPeriod("2026-06", TODAY), periodFor("last_quarter", TODAY), periodFor("ytd", TODAY), customPeriod("2026-10-03", "2026-11-16", TODAY), stepPeriod(stepPeriod(periodFor("this_quarter", TODAY), -1, TODAY), -1, TODAY)]) {
      expect(decodePeriod(encodePeriod(p), TODAY)).toMatchObject({ start: p.start, end: p.end });
    }
    expect(decodePeriod("m:2026-13", TODAY)).toBeNull();
    expect(decodePeriod("nonsense", TODAY)).toBeNull();
  });
});

// The live books' shape: Stripe payments with 5% GST inside, an e-transfer,
// a refund, Stripe fees and one capital item.
const rev = (id: string, date: string, gross: number, tax: number, extra: Partial<RevenueRow> = {}): RevenueRow => ({
  id, date, kind: "payment", grossMinor: gross, taxMinor: tax, method: "stripe", source: "client",
  clientName: "Marc Asugui", product: "Personal Training — 16 Sessions / 4 Weeks", currency: "CAD", stripe: true, reference: null, ...extra,
});
const exp = (id: string, date: string, amount: number, tax: number, extra: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id, expense_date: date, vendor: "Stripe", description: null, category: "bank_fees", amount_minor: amount, tax_minor: tax, currency: "CAD",
  payment_method: "Stripe", business_use_pct: 100, receipt_path: null, receipt_mime: null, status: "reviewed", source: "stripe_fees",
  external_key: null, ai_summary: null, notes: null, created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z`, ...extra,
});

const revenue: RevenueRow[] = [
  rev("p1", "2026-10-16", 16800, 800),
  rev("p2", "2026-10-30", 16800, 800),
  rev("p3", "2026-11-13", 16800, 800),
  rev("p4", "2026-11-16", 67200, 3200, { method: "etransfer", stripe: false }),
  rev("p5", "2026-11-05", 13650, 650, { clientName: "Ashley Santos", product: "Online Coaching — $130/month" }),
  rev("r1", "2026-11-10", 13650, 650, { kind: "refund", clientName: "Ashley Santos", product: "Online Coaching — $130/month" }),
];
const expenses: ExpenseRow[] = [
  exp("e1", "2026-10-08", 5562, 70),
  exp("e2", "2026-11-15", 5308, 61),
  exp("e3", "2026-11-03", 120000, 5714, { vendor: "Rogue", category: "equipment_capital", source: "manual", receipt_path: "x/r.jpg" }),
  exp("e4", "2026-11-04", 4000, 190, { vendor: "Cafe", category: "meals", source: "manual" }),
  exp("e5", "2026-11-06", 2500, 0, { vendor: "Superstore", category: "personal", source: "manual" }),
];
const taxPayments: TaxPaymentRow[] = [
  { id: "t1", paid_on: "2026-11-12", kind: "gst_hst", tax_year: 2026, period_label: "instalment", amount_minor: 50000, reference: "ABC", notes: null, created_at: "2026-11-12" },
];

describe("a period's figures", () => {
  const nov = moneyFigures({ revenue, expenses: expenses.map(toExpenseEntry), settings, range: { start: "2026-11-01", end: "2026-11-30" } });

  it("keeps sales, collected money and GST/HST apart", () => {
    // 16,800 + 67,200 + 13,650 in, 13,650 refunded: GST/HST out, refund out.
    expect(nov.sales.collectedMinor).toBe(16800 + 67200 + 13650);
    expect(nov.sales.refundsMinor).toBe(13650);
    expect(nov.sales.netMinor).toBe(16000 + 64000 + 13000 - 13000);
    expect(nov.sales.gstMinor).toBe(800 + 3200 + 650 - 650);
    expect(nov.sales.paymentCount).toBe(3);
    expect(nov.sales.refundCount).toBe(1);
  });

  it("counts what the business spent, not the GST it gets back or personal spending", () => {
    // Stripe 5,308 − 61, the rack 120,000 − 5,714 in full, the meal 4,000 less the half of its 190 GST claimed back
    // (the other half can't be, so it's part of the meal's cost); groceries left out.
    expect(nov.spent.minor).toBe(5247 + 114286 + 3905);
    expect(nov.spent.paidMinor).toBe(5308 + 120000 + 4000 + 2500);
    expect(nov.spent.personalMinor).toBe(2500);
    expect(nov.spent.capitalMinor).toBe(114286);
    // ITCs: Stripe 61, the rack 5,714, half the meal's 190.
    expect(nov.spent.itcMinor).toBe(61 + 5714 + 95);
    expect(nov.byCategory.map((c) => c.key)).toEqual(["equipment_capital", "bank_fees", "meals"]);
  });

  it("works out profit, margin and taxable profit from those", () => {
    expect(nov.profitMinor).toBe(nov.sales.netMinor - nov.spent.minor);
    expect(nov.margin).toBeCloseTo(nov.profitMinor / nov.sales.netMinor, 6);
    // Taxable: the meal half deductible, the rack as 20% CCA.
    expect(nov.taxableProfitMinor).toBe(nov.sales.netMinor - (5247 + Math.round(3905 / 2)) - Math.round(114286 * 0.2));
    expect(nov.gst).toEqual({ collectedMinor: 4000, itcMinor: 5870, netMinor: 4000 - 5870 });
  });

  it("agrees with the year's tax snapshot over the same days", () => {
    const year = moneyFigures({ revenue, expenses: expenses.map(toExpenseEntry), settings, range: { start: "2026-01-01", end: "2026-12-31" } });
    const snap = buildBooksSnapshot({ year: 2026, asOf: TODAY, settings, revenue, expenses: expenses.map(toExpenseEntry), taxPayments: [] });
    expect(year.sales.netMinor).toBe(snap.revenue.salesMinor);
    expect(year.sales.gstMinor).toBe(snap.revenue.collectedMinor);
    expect(year.spent.itcMinor).toBe(snap.expenses.itcMinor);
    expect(year.taxableProfitMinor).toBe(snap.profitMinor);
  });

  it("sorts payments into services by what was sold", () => {
    const s = (product: string, source: RevenueEntry["source"] = "client") => serviceOf({ product, source });
    expect(s("Personal Training — 16 Sessions / 4 Weeks")).toBe("personal_training");
    expect(s("1:1 Training · 1 session")).toBe("personal_training");
    expect(s("Online Coaching — $130/month")).toBe("coaching");
    expect(s("Month-Month Online Coaching")).toBe("coaching");
    expect(s("AI credits · 300")).toBe("ai_credits");
    expect(s("Anything", "membership")).toBe("membership");
    expect(s("")).toBe("other");
  });

  it("says how a figure moved, without a percent of nothing", () => {
    expect(changeOf(12000, 10000)).toEqual({ diffMinor: 2000, pct: 0.2, direction: "up" });
    expect(changeOf(5000, 0)).toEqual({ diffMinor: 5000, pct: null, direction: "up" });
    expect(changeOf(10050, 10000)?.direction).toBe("flat");
    expect(changeOf(1, null)).toBeNull();
  });

  it("charts month by month with the same definitions", () => {
    const series = monthlySeries({ revenue, expenses: expenses.map(toExpenseEntry), settings, months: ["2026-10", "2026-11"] });
    expect(series[1].salesMinor).toBe(nov.sales.netMinor);
    expect(series[1].spentMinor).toBe(nov.spent.minor);
    expect(series[0]).toMatchObject({ month: "2026-10", salesMinor: 32000, spentMinor: 5492 });
  });

  it("puts aside what a period's profit adds to the year's income tax + CPP, so a year's periods add up to its total", () => {
    const exp = expenses.map(toExpenseEntry);
    const at = (start: string, end: string) => periodTaxReserve({ revenue, expenses: exp, settings, range: { start, end } }).minor;
    const snap = buildBooksSnapshot({ year: 2026, asOf: TODAY, settings, revenue, expenses: exp, taxPayments: [] });
    // The year so far is exactly the Taxes tab's figure (brackets, basic personal amount and CPP), never a flat rate.
    expect(at("2026-01-01", TODAY)).toBe(snap.incomeTax.ytd.totalMinor);
    // Its months add up to it.
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((mm) => at(`2026-${mm}-01`, `2026-${mm}-${new Date(2026, Number(mm), 0).getDate()}`));
    expect(months.reduce((t, x) => t + x, 0) + at("2026-11-01", TODAY)).toBe(snap.incomeTax.ytd.totalMinor);
    // A big year's later month pays the bracket it lands in.
    const big: RevenueEntry[] = [
      { id: "b1", date: "2026-01-15", kind: "payment", grossMinor: 6_300_000, taxMinor: 300_000, source: "client", method: "stripe", product: "Coaching", clientName: "A" } as RevenueEntry,
      { id: "b2", date: "2026-11-02", kind: "payment", grossMinor: 105_000, taxMinor: 5_000, source: "client", method: "stripe", product: "Coaching", clientName: "B" } as RevenueEntry,
    ];
    const novBig = periodTaxReserve({ revenue: big, expenses: [], settings, range: { start: "2026-11-01", end: "2026-11-30" } }).minor;
    const opts = { year: 2026, otherIncomeMinor: 0, structure: "sole_proprietor" as const };
    expect(novBig).toBe(estimateIncomeTax(6_100_000, opts).totalMinor - estimateIncomeTax(6_000_000, opts).totalMinor);
    expect(novBig).toBeGreaterThan(30_000);
    // A month that lost money owes nothing extra.
    const loss = periodTaxReserve({ revenue: [], expenses: exp, settings, range: { start: "2026-11-01", end: "2026-11-30" } }).minor;
    expect(loss).toBe(0);
  });
});

describe("the ledger", () => {
  const rows = ledgerEntries({ revenue, expenses, taxPayments, settings, range: { start: "2026-11-01", end: "2026-11-30" } });

  it("lists money in and out, newest first, signed", () => {
    expect(rows[0]).toMatchObject({ date: "2026-11-16", kind: "in", amountMinor: 67200, taxMinor: 3200, netMinor: 64000, what: "Personal training" });
    const refund = rows.find((r) => r.kind === "refund")!;
    expect(refund).toMatchObject({ amountMinor: -13650, netMinor: -13000 });
    const tax = rows.find((r) => r.kind === "tax")!;
    expect(tax).toMatchObject({ who: "Canada Revenue Agency", amountMinor: -50000, what: "GST/HST payment" });
  });

  it("flags what needs a look", () => {
    const meal = rows.find((r) => r.id === "out:e4")!;
    expect(meal.flags).toContain("no_receipt");
    expect(rows.find((r) => r.id === "out:e3")!.flags).toEqual([]);
    expect(rows.find((r) => r.id === "out:e2")!.flags).toEqual([]); // Stripe fees need no receipt
    expect(rows.find((r) => r.id === "out:e5")!.flags).toContain("personal");
  });

  it("filters, and the totals are the rows shown", () => {
    const out = filterLedger(rows, { type: "out" });
    expect(out.every((r) => r.amountMinor < 0)).toBe(true);
    expect(ledgerTotals(out).outMinor).toBe(5308 + 120000 + 4000 + 2500 + 50000);
    expect(filterLedger(rows, { type: "all", attention: true }).map((r) => r.id)).toEqual(["out:e4"]);
    expect(filterLedger(rows, { type: "in", group: "coaching" }).map((r) => r.kind).sort()).toEqual(["in", "refund"]);
    expect(filterLedger(rows, { type: "all", q: "rogue" }).map((r) => r.id)).toEqual(["out:e3"]);
    expect(filterLedger(rows, { type: "all", method: "etransfer" }).map((r) => r.id)).toEqual(["in:p4"]);
  });
});

describe("recurring expenses", () => {
  it("finds the same vendor paid most months, and leaves Stripe fees and one-offs alone", () => {
    const sub = (id: string, date: string, amount: number) => exp(id, date, amount, 0, { vendor: "Canva", category: "software", source: "manual" });
    const list = recurringExpenses([
      sub("c1", "2026-08-12", 1699), sub("c2", "2026-09-12", 1699), sub("c3", "2026-10-12", 1699), sub("c4", "2026-11-12", 1799),
      exp("s1", "2026-09-30", 3307, 32), exp("s2", "2026-10-08", 5562, 70), exp("s3", "2026-11-15", 5308, 61),
      exp("o1", "2026-11-03", 120000, 0, { vendor: "Rogue", category: "equipment_capital", source: "manual" }),
    ], TODAY);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ vendor: "Canva", category: "Software & subscriptions", minor: 1699, months: 4, lastDate: "2026-11-12", nextAbout: "2026-12-12" });
  });
});

describe("reports match the screens", () => {
  it("a profit and loss adds up to the period's figures", async () => {
    const { profitAndLoss, statementCsv, transactionsCsv, gstLines } = await import("@/lib/books/reports");
    const range = { start: "2026-11-01", end: "2026-11-30" };
    const f = moneyFigures({ revenue, expenses: expenses.map(toExpenseEntry), settings, range });
    const prev = moneyFigures({ revenue, expenses: expenses.map(toExpenseEntry), settings, range: { start: "2026-10-01", end: "2026-10-31" } });
    const rows = profitAndLoss(f, prev, true);
    const services = rows.slice(1, rows.findIndex((r) => r.label === "Total sales"));
    expect(services.reduce((t, r) => t + (r.minor ?? 0), 0)).toBe(f.sales.netMinor);
    const totalExp = rows.findIndex((r) => r.label === "Total expenses");
    const cats = rows.slice(rows.findIndex((r) => r.label.startsWith("Business expenses")) + 1, totalExp);
    expect(cats.reduce((t, r) => t + (r.minor ?? 0), 0)).toBe(f.spent.minor);
    expect(rows.find((r) => r.label === "Profit before income tax")).toMatchObject({ minor: f.profitMinor, prevMinor: prev.profitMinor });
    const text = statementCsv("Profit and loss", "November 2026", "October 2026", rows);
    expect(text.split("\n")[1]).toBe("line,November 2026,October 2026,note");
    expect(gstLines(f).map((l) => l.minor)).toEqual([f.sales.netMinor, f.gst.collectedMinor, f.gst.itcMinor, f.gst.netMinor]);
    const ledger = ledgerEntries({ revenue, expenses, taxPayments, settings, range });
    const lines = transactionsCsv(ledger).split("\n");
    expect(lines).toHaveLength(ledger.length + 1);
    expect(lines[1].startsWith("2026-11-03,Expense,Rogue")).toBe(true);
  });
});
