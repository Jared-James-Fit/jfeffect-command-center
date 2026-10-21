import { describe, expect, it } from "vitest";
import { resolveInstallmentPlan } from "@/lib/installment-plan";
import {
  findReusablePurchaseIntent,
  isReusablePurchaseIntent,
} from "@/lib/purchase-idempotency";

describe("resolveInstallmentPlan", () => {
  it("derives the full contract from installment x count (Marc: 4 x 200 = 800)", () => {
    const plan = resolveInstallmentPlan({
      full_payable_amount: 200,
      installment_amount: 200,
      number_of_payments: 4,
      amount_paid: 200,
      is_recurring: true,
    });
    expect(plan).not.toBeNull();
    expect(plan!.contractTotal).toBe(800);
    expect(plan!.amountRemaining).toBe(600);
    expect(plan!.paymentsMade).toBe(1);
  });

  it("returns null for one-time purchases and open-ended subscriptions", () => {
    expect(resolveInstallmentPlan({ full_payable_amount: 500, number_of_payments: 1 })).toBeNull();
    expect(resolveInstallmentPlan({ full_payable_amount: 200, is_recurring: true })).toBeNull();
  });

  it("compares a before-tax price with payments that include GST (Marc: 2 of 4 × $160 + GST)", () => {
    const plan = resolveInstallmentPlan({
      contract_value_cents: 64000,
      installment_amount: 160,
      number_of_payments: 4,
      amount_paid_cents: 33600,
      amount_tax_paid_cents: 1600,
      is_recurring: true,
    });
    expect(plan!.amountPaid).toBe(336);
    expect(plan!.amountRemaining).toBe(320);
    expect(plan!.paymentsMade).toBe(2);
  });

  it("counts a plan paid off early in fewer payments as done (210 + 210 + 420 on 4 × $200)", () => {
    const plan = resolveInstallmentPlan({
      contract_value_cents: 80000,
      installment_amount: 200,
      number_of_payments: 4,
      amount_paid_cents: 84000,
      amount_tax_paid_cents: 4000,
    });
    expect(plan!.amountRemaining).toBe(0);
    expect(plan!.paymentsMade).toBe(4);
  });

  it("prefers a stored contract value when present", () => {
    const plan = resolveInstallmentPlan({
      contract_value_cents: 90000,
      number_of_payments: 3,
      amount_paid: 0,
    });
    expect(plan!.contractTotal).toBe(900);
    expect(plan!.installmentAmount).toBe(300);
  });
});

describe("purchase idempotency", () => {
  it("reuses an unpaid pending request instead of creating a duplicate sale", () => {
    const found = findReusablePurchaseIntent(
      [
        { id: "a", client_id: "c1", offer_id: "o1", payment_status: "Pending Payment", created_at: "2026-01-01" },
        { id: "b", client_id: "c1", offer_id: "o1", payment_status: "Pending Payment", created_at: "2026-02-01" },
      ],
      { clientId: "c1", offerId: "o1" },
    );
    expect(found?.id).toBe("b");
  });

  it("never reuses a row with Stripe money attached", () => {
    expect(
      isReusablePurchaseIntent({
        id: "a",
        payment_status: "Pending Payment",
        stripe_subscription_id: "sub_1",
      }),
    ).toBe(false);
    expect(isReusablePurchaseIntent({ id: "b", payment_status: "Paid" })).toBe(false);
    expect(
      findReusablePurchaseIntent(
        [{ id: "a", client_id: "c1", offer_id: "o1", payment_status: "Paid", amount_paid: 200 }],
        { clientId: "c1", offerId: "o1" },
      ),
    ).toBeNull();
  });
});
