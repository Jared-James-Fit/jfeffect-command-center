import { describe, expect, it } from "vitest";
import { billingCadence, buildPaymentRequestMessage, formatMoney } from "@/lib/payment-request-message";

describe("auto payment-request chat message", () => {
  it("writes a personal subscription message with price, cadence and link", () => {
    const body = buildPaymentRequestMessage({
      clientFirstName: "Nicole Yusi",
      offerName: "Online Coaching — $130/month",
      amount: 130,
      currency: "CAD",
      paymentStructure: "Monthly subscription",
      isRecurring: true,
      url: "https://jfeffect.com/pay/abc123",
    });
    expect(body).toContain("Hey Nicole! 👋");
    expect(body).toContain("start your subscription ($130/month + applicable tax)");
    expect(body).toContain("https://jfeffect.com/pay/abc123");
  });

  it("uses one-time wording for pay-in-full products", () => {
    const body = buildPaymentRequestMessage({
      clientFirstName: "Reece",
      offerName: "12-Week Program",
      amount: 499.5,
      paymentStructure: "One-time payment",
      isRecurring: false,
      url: "https://jfeffect.com/pay/x",
    });
    expect(body).toContain("complete your payment ($499.50 + applicable tax)");
    expect(body).not.toContain("subscription");
  });

  it("handles missing names and bi-weekly plans", () => {
    expect(buildPaymentRequestMessage({ url: "u" })).toMatch(/^Hey! 👋 Your coaching/);
    expect(billingCadence({ paymentStructure: "Bi-weekly subscription (every 2 weeks) — 4 payments", isRecurring: true })).toBe(" every 2 weeks");
    expect(billingCadence({ paymentStructure: null, isRecurring: false })).toBeNull();
    expect(formatMoney(1200, "CAD")).toBe("$1,200");
  });
});
