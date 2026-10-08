import { describe, expect, it } from "vitest";
import { aggregateStripeFees, gstShareOfTax, monthKeyInZone, stripeFeesExternalKey } from "@/lib/stripe-fees";

// Shapes copied from the live account's balance transactions.
const charge = { id: "txn_c", amount: 13650, created: 1791330449, currency: "cad", fee: 426, fee_details: [{ amount: 426, type: "stripe_fee" }], type: "payment" };
const billing = { id: "txn_b", amount: -96, created: 1791340369, currency: "cad", fee: 11, fee_details: [{ amount: 11, type: "tax" }], type: "stripe_fee" };
const autoTax = { id: "txn_t", amount: -4935, created: 1785237696, currency: "cad", fee: 592, fee_details: [{ amount: 592, type: "tax" }], type: "stripe_fee" };
const instantPayout = { id: "txn_p", amount: -12772, created: 1791326161, currency: "cad", fee: 128, fee_details: [{ amount: 128, type: "stripe_fee" }], type: "payout" };
const payout = { id: "txn_po", amount: -19600, created: 1791417931, currency: "cad", fee: 0, fee_details: [], type: "payout" };
const refund = { id: "txn_r", amount: -3277, created: 1781480233, currency: "usd", fee: 0, fee_details: [], type: "refund" };
const usdCharge = { id: "txn_u", amount: 3277, created: 1781478093, currency: "usd", fee: 125, fee_details: [{ amount: 125, type: "stripe_fee" }], type: "charge" };

describe("gstShareOfTax", () => {
  it("keeps only the GST part of Manitoba's 12% GST + RST", () => {
    expect(gstShareOfTax(592, 4935)).toBe(247);
  });
  it("treats 5% as all GST", () => {
    expect(gstShareOfTax(50, 1000)).toBe(50);
  });
  it("is zero without tax", () => {
    expect(gstShareOfTax(0, 1000)).toBe(0);
  });
});

describe("aggregateStripeFees", () => {
  it("adds processing, service and instant payout fees per month and currency", () => {
    const out = aggregateStripeFees([charge, billing, instantPayout, payout, autoTax, refund, usdCharge] as any);
    const oct = out.find((m) => m.month === "2026-10" && m.currency === "CAD")!;
    expect(oct.processingMinor).toBe(426);
    expect(oct.serviceMinor).toBe(96);
    expect(oct.payoutMinor).toBe(128);
    expect(oct.salesTaxMinor).toBe(11);
    expect(oct.totalMinor).toBe(426 + 96 + 128 + 11);
    expect(oct.gstMinor).toBe(Math.round((11 * 5) / 12));
    expect(oct.count).toBe(3);

    const jul = out.find((m) => m.month === "2026-07")!;
    expect(jul.totalMinor).toBe(4935 + 592);
    expect(jul.gstMinor).toBe(247);

    const usd = out.find((m) => m.currency === "USD")!;
    expect(usd.totalMinor).toBe(125);
    expect(out.map((m) => `${m.month}:${m.currency}`)).toEqual(["2026-06:USD", "2026-07:CAD", "2026-10:CAD"]);
  });

  it("buckets by the Winnipeg month, not UTC", () => {
    // 2026-11-01 03:00 UTC is still October 31 in Winnipeg.
    const t = Date.UTC(2026, 10, 1, 3) / 1000;
    expect(monthKeyInZone(t, "America/Winnipeg")).toBe("2026-10");
  });

  it("uses a stable key per month and currency", () => {
    expect(stripeFeesExternalKey("2026-10", "CAD")).toBe("stripe-fees:2026-10:cad");
  });
});
