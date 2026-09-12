import { describe, it, expect } from "vitest";
import { matchPurchase, shouldApplySubscriptionUpdate, isOpenPurchase } from "@/lib/stripe-purchase-match";

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra }) as any;

describe("matchPurchase", () => {
  it("prefers metadata over every other signal", () => {
    const res = matchPurchase({
      metaRow: row("meta"),
      bySubscription: [row("sub")],
      byCustomer: [row("cust")],
    });
    expect(res.matched?.id).toBe("meta");
    expect((res as any).via).toBe("metadata");
  });

  it("matches a single stamped subscription id", () => {
    const res = matchPurchase({ bySubscription: [row("a")] });
    expect(res.matched?.id).toBe("a");
    expect((res as any).via).toBe("subscription");
  });

  it("matches a single stamped checkout session id", () => {
    const res = matchPurchase({ byCheckoutSession: [row("cs")] });
    expect((res as any).via).toBe("checkout_session");
  });

  it("refuses to guess when two sales share one Stripe id", () => {
    const res = matchPurchase({ bySubscription: [row("a"), row("b")] });
    expect(res.matched).toBeNull();
    expect((res as any).candidates).toEqual(["a", "b"]);
  });

  it("does not fall through from an ambiguous stamped id to the customer", () => {
    const res = matchPurchase({
      byPaymentIntent: [row("a"), row("b")],
      byCustomer: [row("c", { payment_status: "Unpaid" })],
    });
    expect(res.matched).toBeNull();
  });

  it("matches a customer with exactly one sale", () => {
    const res = matchPurchase({ byCustomer: [row("only")] });
    expect((res as any).via).toBe("customer");
  });

  it("picks the single open sale for a repeat customer", () => {
    const res = matchPurchase({
      byCustomer: [row("paid", { payment_status: "Paid" }), row("open", { payment_status: "Pending Payment" })],
    });
    expect(res.matched?.id).toBe("open");
  });

  it("flags a repeat customer with two open sales instead of guessing", () => {
    const res = matchPurchase({
      byCustomer: [
        row("open1", { payment_status: "Pending Payment" }),
        row("open2", { payment_status: "Unpaid" }),
      ],
    });
    expect(res.matched).toBeNull();
    expect((res as any).candidates).toHaveLength(2);
  });

  it("returns an unlinked reason when nothing matches", () => {
    const res = matchPurchase({});
    expect(res.matched).toBeNull();
    expect((res as any).reason).toMatch(/No JF Effect sale/);
  });

  it("treats settled sales as not open", () => {
    expect(isOpenPurchase(row("x", { payment_status: "Paid" }))).toBe(false);
    expect(isOpenPurchase(row("x", { payment_status: "Overdue" }))).toBe(true);
  });
});

describe("shouldApplySubscriptionUpdate", () => {
  it("applies normal updates", () => {
    expect(
      shouldApplySubscriptionUpdate({ payment_status: "Active Subscription" }, { subscriptionId: "sub_1", status: "past_due" }),
    ).toBe(true);
  });

  it("ignores a stale active arriving after cancellation of the same subscription", () => {
    expect(
      shouldApplySubscriptionUpdate(
        { payment_status: "Cancelled", stripe_subscription_id: "sub_1" },
        { subscriptionId: "sub_1", status: "active" },
      ),
    ).toBe(false);
  });

  it("allows a brand-new subscription on a cancelled sale record", () => {
    expect(
      shouldApplySubscriptionUpdate(
        { payment_status: "Cancelled", stripe_subscription_id: "sub_1" },
        { subscriptionId: "sub_2", status: "active" },
      ),
    ).toBe(true);
  });
});
