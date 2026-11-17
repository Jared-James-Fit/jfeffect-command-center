/**
 * The books, ready for what isn't in them yet: other income, repeating bills
 * set up on purpose, and a new tax year whose rates aren't published.
 */
import { describe, expect, it } from "vitest";
import { normalizeRevenue, type ExpenseRow, type OtherIncomeRow, type RecurringExpenseRow } from "@/lib/business-books";
import { toExpenseEntry } from "@/lib/business-books";
import { DEFAULT_TAX_SETTINGS, TAX_TABLE_YEARS, buildBooksSnapshot, estimateIncomeTax, taxTableFor } from "@/lib/business-tax";
import { filterLedger, ledgerEntries, moneyFigures, periodTaxReserve, recurringExpenses, serviceOf } from "@/lib/books/money-view";
import { comparisonFor, periodFor, stepPeriod } from "@/lib/books/period";
import { datesDue, firstOnOrAfter, nextOnProblem, nextRecurringDate, sortBills, yearlyCost } from "@/lib/books/recurring";
import { draftFromDetected } from "@/components/admin/books/recurring-bills";

const settings = { ...DEFAULT_TAX_SETTINGS, gstRegistered: true };

const other = (id: string, over: Partial<OtherIncomeRow> = {}): OtherIncomeRow => ({
  id, received_on: "2026-11-10", payer: "Sponsor Co", description: "Fall promo", kind: "sponsorship",
  amount_minor: 105000, tax_minor: 5000, no_tax_reason: null, currency: "CAD", method: "etransfer",
  deposit_account_id: null, reference: null, proof_path: null, proof_mime: null, notes: null,
  created_at: "2026-11-10", updated_at: "2026-11-10", ...over,
});

const clientPay = {
  id: "p1", txn_type: "payment", method: "stripe", amount_minor: 67200, tax_minor: 3200, currency: "CAD",
  transaction_date: "2026-11-05", voided: false, reversal_of: null, stripe_mode: "live", client_id: "c1",
  clients: { full_name: "Marc" }, purchase_records: { offer_name: "Personal Training — 16 Sessions" },
};

const exp = (id: string, date: string, amount: number, tax: number, over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id, expense_date: date, vendor: "Canva", description: null, category: "software", amount_minor: amount, tax_minor: tax,
  currency: "CAD", payment_method: "Credit card", business_use_pct: 100, receipt_path: null, receipt_mime: null,
  status: "reviewed", source: "manual", external_key: null, ai_summary: null, notes: null, created_at: date, updated_at: date, ...over,
});

describe("other income", () => {
  const revenue = normalizeRevenue([clientPay], [], [], [
    other("s1"),
    other("w1", { kind: "workshop", payer: "Gym X", description: "Deadlift clinic", amount_minor: 30000, tax_minor: 0, no_tax_reason: null, received_on: "2026-11-12" }),
    other("r1", { kind: "referral", payer: "US affiliate", description: null, amount_minor: 8000, tax_minor: 0, no_tax_reason: "outside_canada", currency: "USD", method: "paypal", received_on: "2026-11-14" }),
  ]);
  const nov = { start: "2026-11-01", end: "2026-11-30" };

  it("counts in sales and GST/HST like any payment", () => {
    const f = moneyFigures({ revenue, expenses: [], settings, range: nov });
    expect(f.sales.netMinor).toBe(64000 + 100000 + 30000 + 8000);
    expect(f.sales.gstMinor).toBe(3200 + 5000);
    expect(f.sales.paymentCount).toBe(4);
    const snap = buildBooksSnapshot({ year: 2026, asOf: "2026-11-16", settings, revenue, expenses: [], taxPayments: [] });
    expect(snap.revenue.salesMinor).toBe(f.sales.netMinor);
    expect(snap.revenue.collectedMinor).toBe(f.sales.gstMinor);
  });

  it("is its own line in where sales came from, never a client", () => {
    const f = moneyFigures({ revenue, expenses: [], settings, range: nov });
    expect(f.byService.find((b) => b.key === "other_income")).toMatchObject({ label: "Other income", minor: 138000, count: 3 });
    expect(f.byClient.map((c) => c.label)).toEqual(["Marc"]);
    const snap = buildBooksSnapshot({ year: 2026, asOf: "2026-11-16", settings, revenue, expenses: [], taxPayments: [] });
    expect(snap.revenue.byClient.map((c) => c.client)).toEqual(["Marc"]);
    expect(serviceOf({ source: "other", product: "Personal training workshop" })).toBe("other_income");
  });

  it("flags no GST/HST only when nobody said why", () => {
    const rows = ledgerEntries({ revenue, expenses: [], taxPayments: [], settings, range: nov });
    const byId = (id: string) => rows.find((r) => r.id === `in:other:${id}`)!;
    expect(byId("s1").flags).toEqual([]);
    expect(byId("w1").flags).toContain("no_gst");
    expect(byId("r1").flags).not.toContain("no_gst");
    expect(byId("r1").flags).toContain("foreign");
    expect(byId("s1")).toMatchObject({ who: "Sponsor Co", what: "Other income", detail: "Sponsorship · Fall promo", amountMinor: 105000, netMinor: 100000 });
    expect(byId("s1").revenue?.other?.id).toBe("s1");
    expect(filterLedger(rows, { type: "in", group: "other_income" })).toHaveLength(3);
    const snap = buildBooksSnapshot({ year: 2026, asOf: "2026-11-16", settings, revenue, expenses: [], taxPayments: [] });
    expect(snap.issues.find((i) => i.id === "zero-tax-revenue")).toMatchObject({ count: 1, amountMinor: 30000 });
  });

  it("names a payer-less payment as other income and keeps a reason only when there's no tax", () => {
    const [r] = normalizeRevenue([], [], [], [other("x", { payer: "  ", no_tax_reason: "not_taxable" })]);
    expect(r).toMatchObject({ source: "other", clientName: null, noTaxReason: null, taxMinor: 5000 });
    const rows = ledgerEntries({ revenue: [r], expenses: [], taxPayments: [], settings, range: { start: "2026-11-01", end: "2026-11-30" } });
    expect(rows[0].who).toBe("Other income");
  });
});

describe("repeating bills", () => {
  it("lands on the bill's day each month, the month's last day when it's shorter, never drifting", () => {
    expect(nextRecurringDate("2026-01-31", "month", 31)).toBe("2026-02-28");
    expect(nextRecurringDate("2026-02-28", "month", 31)).toBe("2026-03-31");
    expect(nextRecurringDate("2026-12-15", "month", 15)).toBe("2027-01-15");
    expect(nextRecurringDate("2027-02-28", "year", 29)).toBe("2028-02-29");
    expect(firstOnOrAfter("2026-11-17", "month", 5)).toBe("2026-12-05");
    expect(firstOnOrAfter("2026-11-17", "month", 20)).toBe("2026-11-20");
    expect(firstOnOrAfter("2026-11-17", "year", 5)).toBe("2027-11-05");
  });

  it("says before saving what a start in the past adds, and nothing for one ahead", () => {
    expect(datesDue("2026-09-05", "month", 5, "2026-11-17")).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    expect(datesDue("2026-12-05", "month", 5, "2026-11-17")).toEqual([]);
    expect(datesDue("2020-01-01", "month", 1, "2026-11-17")).toHaveLength(24);
    expect(datesDue("2026-11-17", "year", 17, "2026-11-17")).toEqual(["2026-11-17"]);
  });

  it("never moves a bill back over days it already added", () => {
    expect(nextOnProblem("2026-11-05", "2026-11-05")).toMatch(/after that/);
    expect(nextOnProblem("2026-12-05", "2026-11-05")).toBeNull();
    expect(nextOnProblem("2026-01-01", null)).toBeNull();
  });

  it("costs a year at its pace and lists active bills soonest first", () => {
    expect(yearlyCost({ amount_minor: 1699, every: "month" })).toBe(20388);
    expect(yearlyCost({ amount_minor: 14900, every: "year" })).toBe(14900);
    const b = (id: string, next_on: string, active = true) => ({ id, vendor: id, next_on, active } as RecurringExpenseRow);
    expect(sortBills([b("z", "2026-12-01"), b("a", "2026-11-20"), b("stopped", "2026-01-01", false)]).map((x) => x.id)).toEqual(["a", "z", "stopped"]);
  });

  it("stops suggesting a bill once it's set up, and never counts what a bill added", () => {
    const rows = [
      exp("c1", "2026-08-12", 1699, 81), exp("c2", "2026-09-12", 1699, 81), exp("c3", "2026-10-12", 1699, 81),
      exp("c4", "2026-11-12", 1799, 86, { business_use_pct: 80 }),
    ];
    const found = recurringExpenses(rows, "2026-11-17");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ vendor: "Canva", categoryKey: "software", minor: 1699, taxMinor: 86, businessUsePct: 80, lastDate: "2026-11-12" });
    expect(recurringExpenses(rows, "2026-11-17", [{ vendor: " canva ", category: "software", active: true }])).toEqual([]);
    expect(recurringExpenses(rows, "2026-11-17", [{ vendor: "Canva", category: "software", active: false }])).toHaveLength(1);
    const added = rows.map((r) => ({ ...r, source: "recurring" as const }));
    expect(recurringExpenses(added, "2026-11-17")).toEqual([]);
  });

  it("sets a suggestion up from the month after its last one, never back over months nobody entered", () => {
    const [x] = recurringExpenses([
      exp("c1", "2026-06-12", 1699, 81), exp("c2", "2026-07-12", 1699, 81), exp("c3", "2026-08-12", 1699, 81),
    ], "2026-11-17");
    // Last paid Aug 12: Sep, Oct and Nov 12 aren't assumed paid; the next is Dec 12.
    expect(draftFromDetected(x, "2026-11-17")).toMatchObject({ vendor: "Canva", category: "software", amount_minor: 1699, tax_minor: 81, every: "month", next_on: "2026-12-12" });
    const [y] = recurringExpenses([
      exp("c1", "2026-09-20", 1699, 81), exp("c2", "2026-10-20", 1699, 81), exp("c3", "2026-11-12", 1699, 81),
    ], "2026-11-17");
    expect(draftFromDetected(y, "2026-11-17")?.next_on).toBe("2026-12-12");
  });

  it("asks for each added bill to be checked, apart from Cleo's receipts", () => {
    const added = [exp("r1", "2026-11-05", 1699, 81, { source: "recurring", status: "needs_review", recurring_id: "b1" })];
    const snap = buildBooksSnapshot({ year: 2026, asOf: "2026-11-17", settings, revenue: [], expenses: added.map(toExpenseEntry), taxPayments: [] });
    expect(snap.issues.find((i) => i.id === "recurring-to-check")).toMatchObject({ count: 1, amountMinor: 1699 });
    expect(snap.issues.find((i) => i.id === "needs-review")).toBeUndefined();
    const rows = ledgerEntries({ revenue: [], expenses: added, taxPayments: [], settings, range: { start: "2026-11-01", end: "2026-11-30" } });
    expect(rows[0].flags).toEqual(expect.arrayContaining(["needs_review", "no_receipt"]));
  });
});

describe("a new tax year", () => {
  const pay = (id: string, date: string, gross: number, tax: number) => ({
    id, txn_type: "payment", method: "etransfer", amount_minor: gross, tax_minor: tax, currency: "CAD",
    transaction_date: date, voided: false, reversal_of: null, stripe_mode: null, client_id: "c1",
    clients: { full_name: "Marc" }, purchase_records: { offer_name: "Personal Training" },
  });
  const revenue = normalizeRevenue([pay("a", "2026-12-20", 105000, 5000), pay("b", "2027-01-05", 105000, 5000), pay("c", "2027-02-10", 210000, 10000)], []);

  it("never makes up rates: a year that isn't published uses the latest on file and says so", () => {
    expect(TAX_TABLE_YEARS).toContain(2026);
    const t = taxTableFor(2027);
    expect(t.exact).toBe(false);
    expect(t.table.year).toBe(Math.max(...TAX_TABLE_YEARS.filter((y) => y < 2027)));
    expect(estimateIncomeTax(50_000_00, { year: 2027 }).ratesExact).toBe(false);
    const snap = buildBooksSnapshot({ year: 2027, asOf: "2027-02-15", settings, revenue, expenses: [], taxPayments: [] });
    const flag = snap.issues.find((i) => i.id === "rates");
    expect(flag?.title).toBe("2027 tax rates aren't in the app yet");
    expect(flag?.detail).toContain("2026's");
    const now = buildBooksSnapshot({ year: 2026, asOf: "2026-11-17", settings, revenue, expenses: [], taxPayments: [] });
    expect(now.issues.find((i) => i.id === "rates")).toBeUndefined();
  });

  it("keeps each year's money in its own year and its own filing dates", () => {
    const y26 = buildBooksSnapshot({ year: 2026, asOf: "2027-02-15", settings, revenue, expenses: [], taxPayments: [] });
    const y27 = buildBooksSnapshot({ year: 2027, asOf: "2027-02-15", settings, revenue, expenses: [], taxPayments: [] });
    expect(y26.revenue.salesMinor).toBe(100000);
    expect(y27.revenue.salesMinor).toBe(300000);
    expect(y26.gst.periods.at(-1)?.filingDue).toBe("2027-06-15");
    expect(y27.gst.periods.at(-1)?.filingDue).toBe("2028-06-15");
  });

  it("rolls the periods over on January 1", () => {
    const jan = periodFor("this_month", "2027-01-10");
    expect(jan).toMatchObject({ start: "2027-01-01", label: "January 2027" });
    expect(stepPeriod(jan, -1, "2027-01-10")).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
    expect(periodFor("ytd", "2027-01-10")).toMatchObject({ start: "2027-01-01", end: "2027-01-10", label: "2027 so far" });
    expect(periodFor("last_year", "2027-01-10")).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
    expect(comparisonFor(periodFor("ytd", "2027-01-10"), "previous", "2027-01-10")).toMatchObject({ start: "2026-01-01", end: "2026-01-10" });
  });

  it("puts aside each year's share with that year's own estimate across the boundary", () => {
    const range = { start: "2026-12-01", end: "2027-02-15" };
    const both = periodTaxReserve({ revenue, expenses: [], settings, range });
    const dec = periodTaxReserve({ revenue, expenses: [], settings, range: { start: "2026-12-01", end: "2026-12-31" } });
    const early27 = periodTaxReserve({ revenue, expenses: [], settings, range: { start: "2027-01-01", end: "2027-02-15" } });
    expect(both.minor).toBe(dec.minor + early27.minor);
    expect(both.ratesExact).toBe(false);
    expect(dec.ratesExact).toBe(true);
    // A new year starts its basic personal amount over: the first $3,000 of 2027 profit adds no income tax, only CPP.
    const cppOnly = estimateIncomeTax(300000, { year: 2027 });
    expect(early27.minor).toBe(cppOnly.totalMinor);
    expect(cppOnly.incomeTaxOnBusinessMinor).toBe(0);
  });
});

describe("the GST/HST number", () => {
  it("takes it as CRA writes it, with spaces or dashes typed in", async () => {
    const { gstNumberProblem, normalizeGstNumber } = await import("@/lib/business-tax");
    expect(normalizeGstNumber(" 123 456 782 rt-0001 ")).toBe("123456782RT0001");
    expect(normalizeGstNumber("")).toBeNull();
    expect(gstNumberProblem("123456782RT0001")).toBeNull();
    expect(gstNumberProblem(null)).toBeNull();
  });

  it("refuses what isn't one, and only asks to double-check a check digit", async () => {
    const { gstNumberProblem } = await import("@/lib/business-tax");
    expect(gstNumberProblem("123456782")).toMatchObject({ hard: true });
    expect(gstNumberProblem("12345RT0001")).toMatchObject({ hard: true });
    expect(gstNumberProblem("123456789RT0001")).toMatchObject({ hard: false });
  });
});
