import { describe, expect, it } from "vitest";
import {
  buildBooksSnapshot,
  DEFAULT_TAX_SETTINGS,
  estimateCpp,
  estimateIncomeTax,
  expenseTaxView,
  type ExpenseEntry,
  type RevenueEntry,
} from "@/lib/business-tax";

const pay = (id: string, date: string, gross: number, tax: number, extra: Partial<RevenueEntry> = {}): RevenueEntry => ({
  id, date, kind: "payment", grossMinor: gross, taxMinor: tax, method: "stripe", source: "client",
  clientName: "Client", product: "Coaching", currency: "CAD", stripe: true, ...extra,
});

const exp = (id: string, date: string, amount: number, tax: number, category: string, extra: Partial<ExpenseEntry> = {}): ExpenseEntry => ({
  id, date, vendor: "Vendor", description: null, category, amountMinor: amount, taxMinor: tax, businessUsePct: 100,
  currency: "CAD", hasReceipt: true, status: "reviewed", source: "manual", ...extra,
});

describe("expenseTaxView", () => {
  it("deducts the pre-tax cost and claims the GST back", () => {
    expect(expenseTaxView(exp("a", "2026-03-01", 10500, 500, "software"))).toEqual({
      deductibleMinor: 10000, ccaMinor: 0, itcMinor: 500, businessCostMinor: 10000,
    });
  });

  it("halves meals for both the deduction and the ITC", () => {
    const v = expenseTaxView(exp("a", "2026-03-01", 10500, 500, "meals"));
    expect(v.deductibleMinor).toBe(5000);
    expect(v.itcMinor).toBe(250);
  });

  it("applies business-use % to cost and tax", () => {
    const v = expenseTaxView(exp("a", "2026-03-01", 10500, 500, "phone_internet", { businessUsePct: 60 }));
    expect(v.deductibleMinor).toBe(6000);
    expect(v.itcMinor).toBe(300);
  });

  it("claims first-year CCA on capital items instead of expensing them", () => {
    const v = expenseTaxView(exp("a", "2026-03-01", 105000, 5000, "computer_capital"));
    expect(v.deductibleMinor).toBe(0);
    expect(v.ccaMinor).toBe(55000);
    expect(v.itcMinor).toBe(5000);
  });

  it("never deducts personal items", () => {
    expect(expenseTaxView(exp("a", "2026-03-01", 10500, 500, "personal"))).toEqual({
      deductibleMinor: 0, ccaMinor: 0, itcMinor: 0, businessCostMinor: 0,
    });
  });

  it("treats GST as part of the cost when not registered", () => {
    const v = expenseTaxView(exp("a", "2026-03-01", 10500, 500, "software"), false);
    expect(v.deductibleMinor).toBe(10500);
    expect(v.itcMinor).toBe(0);
  });
});

describe("estimateCpp (2026)", () => {
  it("charges both halves above the $3,500 exemption", () => {
    const c = estimateCpp(50_000_00, 2026);
    expect(c.pensionableMinor).toBe(46_500_00);
    expect(c.baseMinor).toBe(5_533_50);
    expect(c.cpp2Minor).toBe(0);
    expect(c.creditBaseMinor).toBe(2_301_75);
    expect(c.deductionMinor).toBe(3_231_75);
  });

  it("caps at the YMPE and adds CPP2 up to the YAMPE", () => {
    const c = estimateCpp(200_000_00, 2026);
    expect(c.baseMinor).toBe(8_460_90);
    expect(c.cpp2Minor).toBe(832_00);
  });

  it("is zero for a loss", () => {
    expect(estimateCpp(-5_000_00, 2026).totalMinor).toBe(0);
  });
});

describe("estimateIncomeTax", () => {
  it("matches a hand calculation for $50k of business income in Manitoba", () => {
    const t = estimateIncomeTax(50_000_00, { year: 2026 });
    // Net income 46,768.25; federal 3,922.03; Manitoba 3,098.14; CPP 5,533.50
    expect(t.federalTaxMinor).toBe(3_922_03);
    expect(t.provincialTaxMinor).toBe(3_098_14);
    expect(t.totalMinor).toBe(12_553_67);
    expect(t.marginalRate).toBeGreaterThan(0.3);
    expect(t.marginalRate).toBeLessThan(0.4);
  });

  it("only charges the business for tax above the other income", () => {
    const alone = estimateIncomeTax(20_000_00, { year: 2026 });
    const onTop = estimateIncomeTax(20_000_00, { year: 2026, otherIncomeMinor: 60_000_00 });
    expect(onTop.incomeTaxOnBusinessMinor).toBeGreaterThan(alone.incomeTaxOnBusinessMinor);
  });

  it("uses the small business rate for a corporation", () => {
    const t = estimateIncomeTax(100_000_00, { year: 2026, structure: "corporation" });
    expect(t.totalMinor).toBe(9_000_00);
    expect(t.cpp.totalMinor).toBe(0);
  });

  it("falls back to the latest loaded year and says so", () => {
    const t = estimateIncomeTax(50_000_00, { year: 2027 });
    expect(t.ratesYear).toBe(2026);
    expect(t.ratesExact).toBe(false);
  });
});

describe("buildBooksSnapshot", () => {
  const base = {
    year: 2026,
    asOf: "2026-10-08",
    settings: { ...DEFAULT_TAX_SETTINGS, gstNumber: "123456789RT0001", stripeFeesSyncedAt: "2026-10-08T00:00:00Z" },
    taxPayments: [],
  };

  it("nets GST collected against ITCs and payments already made", () => {
    const s = buildBooksSnapshot({
      ...base,
      revenue: [pay("p1", "2026-07-01", 105_00, 5_00), pay("p2", "2026-08-01", 210_00, 10_00)],
      expenses: [exp("e1", "2026-07-15", 52_50, 2_50, "software")],
      taxPayments: [{ id: "t1", paidOn: "2026-09-01", kind: "gst_hst", taxYear: 2026, amountMinor: 5_00, periodLabel: null }],
    });
    expect(s.revenue.salesMinor).toBe(300_00);
    expect(s.revenue.collectedMinor).toBe(15_00);
    expect(s.expenses.itcMinor).toBe(2_50);
    expect(s.gst.netTaxMinor).toBe(12_50);
    expect(s.gst.owingMinor).toBe(7_50);
    expect(s.profitMinor).toBe(250_00);
    expect(s.gst.periods).toHaveLength(1);
    expect(s.gst.periods[0].filingDue).toBe("2027-06-15");
    expect(s.gst.periods[0].paymentDue).toBe("2027-04-30");
  });

  it("subtracts refunds from sales and from GST collected", () => {
    const s = buildBooksSnapshot({
      ...base,
      revenue: [pay("p1", "2026-07-01", 105_00, 5_00), { ...pay("r1", "2026-07-02", 105_00, 5_00), kind: "refund" }],
      expenses: [],
    });
    expect(s.revenue.salesMinor).toBe(0);
    expect(s.revenue.collectedMinor).toBe(0);
    expect(s.revenue.refundCount).toBe(1);
  });

  it("ignores other years", () => {
    const s = buildBooksSnapshot({
      ...base,
      revenue: [pay("old", "2025-12-31", 105_00, 5_00), pay("new", "2026-01-01", 105_00, 5_00)],
      expenses: [exp("old", "2025-06-01", 100_00, 0, "other")],
    });
    expect(s.revenue.paymentCount).toBe(1);
    expect(s.expenses.count).toBe(0);
  });

  it("splits GST into quarters for quarterly filers with the right due dates", () => {
    const s = buildBooksSnapshot({
      ...base,
      settings: { ...base.settings, gstFilingFrequency: "quarterly" },
      revenue: [pay("p1", "2026-02-01", 105_00, 5_00), pay("p2", "2026-11-01", 105_00, 5_00)],
      expenses: [],
    });
    expect(s.gst.periods.map((p) => p.label)).toEqual(["Q1 (Jan-Mar)", "Q2 (Apr-Jun)", "Q3 (Jul-Sep)", "Q4 (Oct-Dec)"]);
    expect(s.gst.periods[0].collectedMinor).toBe(5_00);
    expect(s.gst.periods[0].filingDue).toBe("2026-04-30");
    expect(s.gst.periods[3].filingDue).toBe("2027-01-31");
    expect(s.gst.periods[0].closed).toBe(true);
    expect(s.gst.periods[3].closed).toBe(false);
  });

  it("projects the rest of the year from the recent pace", () => {
    const s = buildBooksSnapshot({
      ...base,
      asOf: "2026-06-30",
      revenue: [pay("p0", "2026-03-01", 5_250_00, 250_00), pay("p1", "2026-06-01", 10_500_00, 500_00)],
      expenses: [],
    });
    // 90-day window Apr 2 - Jun 30 has $10,000 over 90 days; 184 days remain.
    expect(s.projection.salesMinor).toBe(15_000_00 + Math.round((10_000_00 / 90) * 184));
    expect(s.inProgress).toBe(true);
  });

  it("does not repeat a prepaid annual package in the projection", () => {
    const monthly = ["2026-07-15", "2026-08-15", "2026-09-15", "2026-10-01"].map((d, i) => pay(`m${i}`, d, 210_00, 10_00));
    const s = buildBooksSnapshot({
      ...base,
      revenue: [...monthly, pay("annual", "2026-07-31", 4_935_00, 235_00)],
      expenses: [],
    });
    // Window = first sale Jul 15 to Oct 8 (86 days): $800 of monthly payments; the $4,700 is counted once.
    expect(s.projection.salesMinor).toBe(s.revenue.salesMinor + Math.round((800_00 / 86) * 84));
    expect(s.projection.basis).toMatch(/not repeating 1 one-off payment/);
  });

  it("uses the days since the first sale when the business is newer than 90 days", () => {
    const s = buildBooksSnapshot({
      ...base,
      asOf: "2026-06-30",
      revenue: [pay("p1", "2026-06-01", 3_150_00, 150_00)],
      expenses: [],
    });
    // Jun 1 - Jun 30 is 30 days of history, not 90 days with 60 empty ones.
    expect(s.projection.salesMinor).toBe(3_000_00 + Math.round((3_000_00 / 30) * 184));
  });

  it("treats a past year as final", () => {
    const s = buildBooksSnapshot({ ...base, year: 2025, asOf: "2026-10-08", revenue: [pay("p", "2025-05-01", 105_00, 5_00)], expenses: [] });
    expect(s.inProgress).toBe(false);
    expect(s.projection.salesMinor).toBe(s.revenue.salesMinor);
  });

  it("flags payments with no GST, missing receipts and unconfirmed scans", () => {
    const s = buildBooksSnapshot({
      ...base,
      revenue: [pay("dep", "2026-06-19", 100_00, 0)],
      expenses: [
        exp("e1", "2026-07-01", 10_00, 0, "supplies", { hasReceipt: false }),
        exp("e2", "2026-07-02", 10_00, 0, "uncategorized", { status: "needs_review" }),
        exp("fees", "2026-07-31", 30_00, 0, "bank_fees", { hasReceipt: false, source: "stripe_fees" }),
      ],
    });
    const ids = s.issues.map((i) => i.id);
    expect(ids).toContain("zero-tax-revenue");
    expect(ids).toContain("needs-review");
    expect(ids).toContain("uncategorized");
    expect(s.issues.find((i) => i.id === "no-receipt")?.count).toBe(1);
  });

  it("builds T2125 lines from categories", () => {
    const s = buildBooksSnapshot({
      ...base,
      revenue: [pay("p1", "2026-07-01", 1_050_00, 50_00)],
      expenses: [
        exp("a", "2026-07-01", 105_00, 5_00, "software"),
        exp("b", "2026-07-01", 21_00, 1_00, "office"),
        exp("c", "2026-07-01", 30_00, 0, "bank_fees", { source: "stripe_fees", hasReceipt: false }),
      ],
    });
    const line = (l: string) => s.t2125.find((x) => x.line === l)?.amountMinor;
    expect(line("8000")).toBe(1_000_00);
    expect(line("8810")).toBe(120_00);
    expect(line("8710")).toBe(30_00);
    expect(line("9369")).toBe(850_00);
  });

  it("suggests the Quick Method only when it saves real money", () => {
    const big = buildBooksSnapshot({
      ...base,
      revenue: [pay("p1", "2026-07-01", 52_500_00, 2_500_00)],
      expenses: [],
    });
    expect(big.gst.quickMethod?.savingsMinor).toBeGreaterThan(100_00);
    expect(big.tips.map((t) => t.id)).toContain("quick-method");

    const heavy = buildBooksSnapshot({
      ...base,
      revenue: [pay("p1", "2026-07-01", 10_500_00, 500_00)],
      expenses: [exp("rent", "2026-07-01", 6_300_00, 300_00, "rent")],
    });
    expect(heavy.tips.map((t) => t.id)).not.toContain("quick-method");
  });

  it("adds what is owed now from GST and income tax, net of payments", () => {
    const s = buildBooksSnapshot({
      ...base,
      revenue: [pay("p1", "2026-07-01", 52_500_00, 2_500_00)],
      expenses: [],
      taxPayments: [{ id: "i", paidOn: "2026-09-15", kind: "income_tax", taxYear: 2026, amountMinor: 1_000_00, periodLabel: null }],
    });
    expect(s.incomeTax.owingNowMinor).toBe(s.incomeTax.ytd.totalMinor - 1_000_00);
    expect(s.setAsideNowMinor).toBe(2_500_00 + s.incomeTax.owingNowMinor);
  });
});
