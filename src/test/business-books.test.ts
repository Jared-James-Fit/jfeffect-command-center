import { describe, expect, it } from "vitest";
import { booksYears, normalizeRevenue, parseMoneyToMinor, type BooksData, type LedgerRowIn } from "@/lib/business-books";
import { receiptNeedsReview, sanitizeReceiptRead } from "@/lib/business-books.server";
import { buildSummerContext, summerSystemPrompt } from "@/lib/summer-context";

const row = (over: Partial<LedgerRowIn>): LedgerRowIn => ({
  id: "x", txn_type: "payment", method: "stripe", amount_minor: 10500, tax_minor: 500, currency: "cad",
  transaction_date: "2026-07-01", voided: false, reversal_of: null, stripe_mode: "live",
  clients: { full_name: "Marc" }, purchase_records: { offer_name: "Online Coaching" }, ...over,
});

describe("normalizeRevenue", () => {
  it("keeps real payments and refunds and drops everything that is not cash", () => {
    const out = normalizeRevenue(
      [
        row({ id: "pay" }),
        row({ id: "dep", txn_type: "deposit", tax_minor: 0, amount_minor: 10000 }),
        row({ id: "void", voided: true }),
        row({ id: "rev", txn_type: "reversal", amount_minor: -10500 }),
        row({ id: "test", stripe_mode: "test" }),
        row({ id: "credit", txn_type: "credit_applied" }),
        row({ id: "fromcredit", method: "credit_balance" }),
        row({ id: "ref", txn_type: "refund", tax_minor: 0, amount_minor: 5250, reversal_of: "pay" }),
      ],
      [
        { id: "m1", amount_cents: 3277, currency: "usd", payment_date: "2026-06-14T00:00:00Z", status: "refunded", payment_method: "stripe", stripe_mode: "live", service_product: null },
        { id: "m2", amount_cents: 2000, currency: "cad", payment_date: "2026-08-01T00:00:00Z", status: "paid", payment_method: "stripe", stripe_mode: "live", service_product: "App" },
      ],
    );
    expect(out.map((r) => r.id)).toEqual(["pay", "dep", "ref", "m2"]);
    const refund = out.find((r) => r.id === "ref")!;
    expect(refund.kind).toBe("refund");
    // Half the original refunded: half its GST, worked out from the original.
    expect(refund.taxMinor).toBe(250);
    expect(refund.taxEstimated).toBe(true);
    expect(out.find((r) => r.id === "pay")).toMatchObject({ clientName: "Marc", product: "Online Coaching", currency: "CAD", stripe: true });
    expect(out.find((r) => r.id === "m2")).toMatchObject({ source: "membership", taxMinor: 0, date: "2026-08-01" });
  });
});

describe("parseMoneyToMinor", () => {
  it("reads typed dollar amounts", () => {
    expect(parseMoneyToMinor("$1,234.50")).toBe(123450);
    expect(parseMoneyToMinor("12")).toBe(1200);
    expect(parseMoneyToMinor("")).toBeNull();
    expect(parseMoneyToMinor("abc")).toBeNull();
    expect(parseMoneyToMinor("-5")).toBeNull();
  });
});

describe("sanitizeReceiptRead", () => {
  it("accepts a clean read", () => {
    const r = sanitizeReceiptRead(
      { is_receipt: true, vendor: "Rogue Fitness", date: "2026-09-02", total: "52.50", gst_hst: 2.5, pst: 3.5, currency: "cad", category: "supplies", description: "Straps", business_use_pct: 100, confidence: 0.93 },
      "2026-10-08",
    );
    expect(r).toMatchObject({ vendor: "Rogue Fitness", date: "2026-09-02", totalMinor: 5250, gstMinor: 250, pstMinor: 350, currency: "CAD", category: "supplies" });
    expect(receiptNeedsReview(r)).toBe(false);
  });

  it("refuses made-up shapes and flags them for review", () => {
    const r = sanitizeReceiptRead({ total: 10, gst_hst: 50, date: "2031-01-01", category: "yachts", confidence: 2 }, "2026-10-08");
    expect(r.gstMinor).toBe(0);
    expect(r.date).toBeNull();
    expect(r.category).toBe("uncategorized");
    expect(r.confidence).toBe(1);
    expect(receiptNeedsReview(r)).toBe(true);
  });

  it("flags low confidence and non-receipts", () => {
    expect(receiptNeedsReview(sanitizeReceiptRead({ total: 5, date: "2026-10-01", category: "office", confidence: 0.5 }, "2026-10-08"))).toBe(true);
    expect(receiptNeedsReview(sanitizeReceiptRead({ is_receipt: false, total: 5, date: "2026-10-01", category: "office", confidence: 0.99 }, "2026-10-08"))).toBe(true);
  });
});

describe("Summer context", () => {
  const data: BooksData = {
    asOf: "2026-10-08",
    settings: null,
    revenue: normalizeRevenue([row({ id: "pay", amount_minor: 136500, tax_minor: 6500, clients: { full_name: "Colten" } })], []),
    expenses: [
      {
        id: "e1", expense_date: "2026-09-02", vendor: "Rogue", description: "Straps", category: "supplies", amount_minor: 5250, tax_minor: 250,
        currency: "CAD", payment_method: null, business_use_pct: 100, receipt_path: null, receipt_mime: null, status: "reviewed",
        source: "manual", external_key: null, ai_summary: null, notes: null, created_at: "", updated_at: "",
      },
    ],
    taxPayments: [],
    openSales: [{ id: "o", client: "Reece", offer: "Hybrid", status: "Unpaid", outstandingMinor: 40000, createdOn: "2026-10-01" }],
    years: [],
  };
  data.years = booksYears(data);

  it("gives the assistant the real numbers and rows", () => {
    const ctx = buildSummerContext(data, 2026);
    expect(ctx).toContain("GST/HST collected (line 103): $65.00");
    expect(ctx).toContain("Colten");
    expect(ctx).toContain("Rogue");
    expect(ctx).toContain("Reece | Hybrid | Unpaid | outstanding $400.00");
    expect(ctx).toContain("receipt");
  });

  it("names the assistant and forbids invented numbers", () => {
    const p = summerSystemPrompt();
    expect(p).toContain("Summer Ledger");
    expect(p).toMatch(/Never invent/);
  });
});
