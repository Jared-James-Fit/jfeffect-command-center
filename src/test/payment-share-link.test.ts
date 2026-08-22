import { describe, it, expect } from "vitest";
import {
  sanitizeShareUrl,
  choosePaymentShareStrategy,
  isCheckoutSessionShareable,
  isStripePaymentLinkUrl,
  isStripeCheckoutSessionUrl,
  isStripeHostedInvoiceUrl,
} from "@/lib/payment-share-link";

describe("sanitizeShareUrl", () => {
  it("strips zero-width and smart wrapping characters", () => {
    expect(sanitizeShareUrl("\u200bhttps://buy.stripe.com/abc\ufeff")).toBe("https://buy.stripe.com/abc");
  });
  it("trims whitespace and newlines from copy/paste", () => {
    expect(sanitizeShareUrl("  https://buy.stripe.com/abc\n")).toBe("https://buy.stripe.com/abc");
  });
  it("rejects non-https or malformed values", () => {
    expect(sanitizeShareUrl("http://buy.stripe.com/abc")).toBeNull();
    expect(sanitizeShareUrl("not a url")).toBeNull();
    expect(sanitizeShareUrl(null)).toBeNull();
    expect(sanitizeShareUrl("")).toBeNull();
  });
  it("never returns a url containing spaces (iMessage truncation guard)", () => {
    const out = sanitizeShareUrl("https://buy.stripe.com/abc def");
    expect(out).toBeNull();
  });
});

describe("stripe url classification", () => {
  it("classifies each url family", () => {
    expect(isStripePaymentLinkUrl("https://buy.stripe.com/8wM3cA")).toBe(true);
    expect(isStripeCheckoutSessionUrl("https://checkout.stripe.com/c/pay/cs_live_123")).toBe(true);
    expect(isStripeHostedInvoiceUrl("https://invoice.stripe.com/i/acct_1/live_abc")).toBe(true);
    expect(isStripePaymentLinkUrl("https://checkout.stripe.com/c/pay/cs_live_123")).toBe(false);
  });
});

describe("isCheckoutSessionShareable", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const past = Math.floor(Date.now() / 1000) - 3600;
  it("accepts open, unexpired sessions", () => {
    expect(isCheckoutSessionShareable({ status: "open", url: "https://checkout.stripe.com/c/pay/cs_1", expires_at: future })).toBe(true);
  });
  it("rejects expired or completed sessions", () => {
    expect(isCheckoutSessionShareable({ status: "open", url: "https://checkout.stripe.com/c/pay/cs_1", expires_at: past })).toBe(false);
    expect(isCheckoutSessionShareable({ status: "complete", url: "https://checkout.stripe.com/c/pay/cs_1", expires_at: future })).toBe(false);
    expect(isCheckoutSessionShareable(null)).toBe(false);
  });
});

describe("choosePaymentShareStrategy", () => {
  it("returns none for settled purchases", () => {
    expect(
      choosePaymentShareStrategy({ paymentStatus: "Paid", productPaymentLinkUrl: "https://buy.stripe.com/x" }).kind,
    ).toBe("none");
  });
  it("prefers a hosted invoice for overdue subscriptions", () => {
    const s = choosePaymentShareStrategy({
      paymentStatus: "Overdue",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_1/live_abc",
      productPaymentLinkUrl: "https://buy.stripe.com/x",
    });
    expect(s.kind).toBe("hosted_invoice");
  });
  it("prefers a reusable payment link over a checkout session", () => {
    const s = choosePaymentShareStrategy({
      paymentStatus: "Pending",
      productPaymentLinkUrl: "https://buy.stripe.com/x",
      existingSession: { status: "open", url: "https://checkout.stripe.com/c/pay/cs_live_123", expires_at: Math.floor(Date.now()/1000)+3600 },
    });
    expect(s.kind).toBe("payment_link");
  });
  it("falls back to checkout session when nothing reusable exists", () => {
    const s = choosePaymentShareStrategy({ paymentStatus: "Pending" });
    expect(s.kind).toBe("checkout_session");
  });
});
