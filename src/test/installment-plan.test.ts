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
