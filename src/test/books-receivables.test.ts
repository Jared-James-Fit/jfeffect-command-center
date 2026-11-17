import { describe, expect, it } from "vitest";
import { buildClientPayments } from "@/lib/payment-schedule";
import { bookedIn, receivablesFrom } from "@/lib/books/receivables";
import marc from "./fixtures/marc-billing-2026-11-16.json";

const TODAY = "2026-11-16";

// Marc on Nov 16 2026 after his e-transfer: Packages 1-3 paid, Package 4
// ($672 with GST) left, paid by his auto-pay from Nov 27.
const marcSales = (marc.sales as any[]).map((s) => (s.package_number === 3 ? { ...s, amount_paid: 672, amount_paid_cents: 67200, amount_tax_paid_cents: 3200, amount_outstanding_cents: 0, payment_status: "Paid" } : s));
const marcPays = buildClientPayments({ sales: marcSales, ledger: [...marc.ledger, marc.etransfer] as any[], today: TODAY });

// A $30,000 plan whose payment link was never paid (Yannick's, Jun 7), and an
// archived test account's unpaid link.
const linkSale = (id: string, client: string, cents: number, status = "Unpaid") => ({
  id, client_id: client, offer_name: "JJF Private Coaching 12M Full", payment_status: status, contract_value_cents: cents, full_payable_amount: cents / 100,
  amount_paid_cents: 0, amount_paid: 0, currency: "CAD", created_at: "2026-06-07T12:00:00Z", purchased_at: "2026-06-07T12:00:00Z", is_recurring: false,
  payment_structure: "One-time payment",
});
const yannickSales = [linkSale("y1", "yannick", 3_000_000)];
const yannickPays = buildClientPayments({ sales: yannickSales as any[], ledger: [], today: TODAY });
const demoSales = [linkSale("d1", "demo", 10_000, "Pending")];
const demoPays = buildClientPayments({ sales: demoSales as any[], ledger: [], today: TODAY });

const r = receivablesFrom(
  [
    { clientId: "marc", client: "Marc Asugui", archived: false, p: marcPays, sales: marcSales as any[] },
    { clientId: "yannick", client: "Yannick Ring", archived: false, p: yannickPays, sales: yannickSales as any[] },
    { clientId: "demo", client: "Alex Demo", archived: true, p: demoPays, sales: demoSales as any[] },
  ],
  TODAY,
);

describe("receivables", () => {
  it("is what each client's Billing tab says is owed, with tax", () => {
    expect(r.outstandingCents).toBe(marcPays.outstandingCents);
    expect(r.outstandingCents).toBe(67200);
    expect(r.overdueCents).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ client: "Marc Asugui", label: "Package 4", outstandingCents: 67200, how: "auto_pay" });
  });

  it("never counts a payment link nobody paid as owed, and leaves archived accounts' links out", () => {
    expect(r.waiting.map((w) => w.client)).toEqual(["Yannick Ring"]);
    expect(r.waitingCents).toBe(yannickPays.waiting[0].cents);
    expect(r.lines.some((l) => l.client === "Yannick Ring")).toBe(false);
  });

  it("forecasts the next 30 days from the real schedule", () => {
    expect(r.expected.every((e) => e.date >= TODAY && e.date <= "2026-12-16")).toBe(true);
    expect(r.expected30Cents).toBe(r.expected.reduce((t, e) => t + e.cents, 0));
    expect(r.expected.length).toBeGreaterThan(0);
  });

  it("books a sale on the day it was sold, never an unpaid link", () => {
    expect(r.booked.some((b) => b.saleId === "y1")).toBe(false);
    const nov = bookedIn(r, { start: "2026-11-01", end: "2026-11-30" });
    expect(nov.rows.map((b) => b.label)).toEqual(["Personal Training — 16 Sessions / 4 Weeks"]);
    expect(nov.minor).toBe(64000);
    expect(nov.rows[0].service).toBe("personal_training");
  });
});

describe("recording a payment against what's owed (the finance desk)", () => {
  it("carries the client's own tax rate and next payment from Billing", async () => {
    const { owedRows } = await import("@/components/admin/money/use-receivables");
    const { recordMoneyFor } = await import("@/components/admin/finance/record-payment-dialog");
    expect(r.lines[0].rate).toBeCloseTo(0.05, 4);
    const [row] = owedRows(r);
    expect(row).toMatchObject({ id: r.lines[0].saleId, clientId: "marc", outstandingMinor: 67200, viaStripe: true });
    expect(row.nextCents).toBe(r.lines[0].next?.cents);
    // The dialog suggests the next payment, tax split at Marc's own rate.
    const money = recordMoneyFor(row);
    expect(money.next?.cents).toBe(row.nextCents);
    expect(money.rate).toBeCloseTo(0.05, 4);
  });

  it("splits the GST/HST out of an amount that includes it", async () => {
    const { taxInside } = await import("@/lib/sale-money");
    expect(taxInside(67200, 0.05)).toBe(3200);
    expect(taxInside(14690, 0.13)).toBe(1690);
    expect(taxInside(10000, null)).toBe(0);
    expect(taxInside(10000, 0)).toBe(0);
  });
});
