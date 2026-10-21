import { describe, expect, it } from "vitest";
import { clientOwed, saleOwedCents, sessionPriceCents } from "@/lib/client-owed";

// Marc Asugui, Oct 21 2026: package 1 paid off, package 2 half paid, 10 sessions past both.
const pkg1 = {
  id: "p1", offer_name: "Personal Training — 16 Sessions / 4 Weeks", payment_status: "Paid", is_recurring: false,
  contract_value_cents: 80000, installment_amount: 200, number_of_payments: 4,
  amount_paid_cents: 84000, amount_tax_paid_cents: 4000, sessions_purchased: 16, purchased_at: "2026-08-22",
};
const pkg2 = {
  id: "p2", offer_name: "Marc Asugui — 16 Personal Training Sessions", payment_status: "Active Subscription", is_recurring: true,
  contract_value_cents: 64000, installment_amount: 160, number_of_payments: 4,
  amount_paid_cents: 33600, amount_tax_paid_cents: 1600, sessions_purchased: 16, purchased_at: "2026-10-02",
};

describe("what a client owes", () => {
  it("counts the payments still to come on an installment plan, before tax", () => {
    expect(saleOwedCents(pkg1)).toBe(0);
    expect(saleOwedCents(pkg2)).toBe(32000);
  });

  it("owes nothing on a subscription that renews until cancelled", () => {
    expect(saleOwedCents({ payment_status: "Active Subscription", is_recurring: true, full_payable_amount: 130, amount_paid_cents: 13650, amount_tax_paid_cents: 650 })).toBe(0);
  });

  it("owes nothing on cancelled, archived or draft sales, and the full price on an unpaid one", () => {
    expect(saleOwedCents({ ...pkg2, payment_status: "Cancelled" })).toBe(0);
    expect(saleOwedCents({ ...pkg2, archived_at: "2026-10-21" })).toBe(0);
    expect(saleOwedCents({ payment_status: "Draft", contract_value_cents: 50000, amount_paid_cents: 0 })).toBe(0);
    expect(saleOwedCents({ payment_status: "Unpaid", contract_value_cents: 10000, amount_paid_cents: 0 })).toBe(10000);
  });

  it("prices sessions past what was bought at the latest package", () => {
    expect(sessionPriceCents([pkg1, pkg2])).toBe(4000);
    const owed = clientOwed([pkg1, pkg2], 10);
    expect(owed).toMatchObject({ salesCents: 32000, unbilledSessions: 10, sessionPriceCents: 4000, unbilledCents: 40000, totalCents: 72000, taxed: true });
  });

  it("still counts the sessions when no package has a price", () => {
    expect(clientOwed([{ payment_status: "Paid", sessions_purchased: 0 }], 3)).toMatchObject({ unbilledSessions: 3, unbilledCents: 0, totalCents: 0 });
  });
});
