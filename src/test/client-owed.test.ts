import { describe, expect, it } from "vitest";
import { clientOwed, packageRenewal, saleOwedCents, sessionPriceCents } from "@/lib/client-owed";

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

  it("training past the last package starts a renewal of it: the next 16 at its price", () => {
    expect(sessionPriceCents([pkg1, pkg2])).toBe(4000);
    const owed = clientOwed([pkg1, pkg2], 10, 10);
    expect(owed).toMatchObject({ salesCents: 32000, unbilledSessions: 10, renewalCents: 64000, totalCents: 96000, taxed: true });
    expect(owed.renewal).toEqual({
      fromSaleId: "p2", name: "Marc Asugui — 16 Personal Training Sessions", size: 16, priceCents: 64000,
      count: 1, trained: 10, bookedIn: 6, bookedAfter: 4,
    });
  });

  it("needs a second renewal once the trained sessions fill the first", () => {
    expect(packageRenewal([pkg2], 17, 0)).toMatchObject({ count: 2, bookedIn: 0, bookedAfter: 0 });
    expect(packageRenewal([pkg2], 16, 3)).toMatchObject({ count: 1, bookedIn: 0, bookedAfter: 3 });
  });

  it("owes nothing for sessions only booked past the package: the renewal starts when one is trained", () => {
    expect(packageRenewal([pkg2], 0, 4)).toMatchObject({ count: 0, bookedIn: 0, bookedAfter: 4 });
    expect(clientOwed([pkg2], 0, 4)).toMatchObject({ renewalCents: 0 });
  });

  it("still counts the sessions when no package has a price", () => {
    expect(clientOwed([{ payment_status: "Paid", sessions_purchased: 0 }], 3)).toMatchObject({ unbilledSessions: 3, renewal: null, renewalCents: 0, totalCents: 0 });
  });
});
