import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateShareToken,
  isValidShareToken,
  buildShareUrl,
  isJfShareUrl,
  isMessageSafeUrl,
  shouldWrapForSharing,
} from "@/lib/payment-share-token";
import { getShareablePaymentUrl } from "@/components/payments/copy-payment-link-button";

const GIANT_CHECKOUT_URL =
  "https://checkout.stripe.com/c/pay/cs_live_" +
  "a1".repeat(60) +
  "#fidkdWxOYHwnPyd1blpxYHZxWjA0S2N%2FVUxLYUt8fGRxfEB8VXdoZ2FEfGxxN2p0YEsn";

describe("short share token", () => {
  it("generates unguessable url-safe tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateShareToken();
      expect(isValidShareToken(t)).toBe(true);
      expect(t).toMatch(/^[A-Za-z0-9]{12}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it("rejects invalid tokens (fails safe)", () => {
    for (const bad of ["", "abc", "../../etc/passwd", "tok en", "a".repeat(64), null, 42, "with-dash-x"]) {
      expect(isValidShareToken(bad as any)).toBe(false);
    }
  });

  it("builds one clean https URL with no fragment", () => {
    const url = buildShareUrl("https://jfeffect.com", "AbC123xyz789");
    expect(url).toBe("https://jfeffect.com/pay/AbC123xyz789");
    expect(isJfShareUrl(url)).toBe(true);
    expect(isMessageSafeUrl(url)).toBe(true);
    expect(buildShareUrl("https://jfeffect.com/", "AbC123xyz789")).toBe(url);
  });

  it("classifies the giant Stripe checkout URL as NOT iMessage-safe", () => {
    expect(isMessageSafeUrl(GIANT_CHECKOUT_URL)).toBe(false);
    expect(GIANT_CHECKOUT_URL.includes("#")).toBe(true);
  });

  it("wraps checkout sessions but never reusable payment links", () => {
    expect(shouldWrapForSharing("checkout_session", GIANT_CHECKOUT_URL)).toBe(true);
    expect(shouldWrapForSharing("payment_link", "https://buy.stripe.com/aBc123")).toBe(false);
    expect(shouldWrapForSharing("hosted_invoice", "https://invoice.stripe.com/i/acct_1/live_" + "x".repeat(200))).toBe(true);
    expect(shouldWrapForSharing("hosted_invoice", "https://invoice.stripe.com/i/short")).toBe(false);
    expect(shouldWrapForSharing("none", null)).toBe(false);
  });
});

describe("getShareablePaymentUrl (clipboard contract)", () => {
  const origin = "https://jfeffect.com";
  beforeAllOrigin();

  function beforeAllOrigin() {
    (globalThis as any).window = { location: { origin } };
  }

  it("copies the SHORT JF Effect URL for a dynamic checkout session, never the raw Stripe URL", async () => {
    const shareFn = vi.fn(async () => ({
      kind: "checkout_session",
      shareUrl: "https://jfeffect.com/pay/AbC123xyz789",
      canonicalUrl: GIANT_CHECKOUT_URL,
      needsFreshCheckout: false,
      label: "Coaching",
    }));
    const checkoutFn = vi.fn();
    const res = await getShareablePaymentUrl(shareFn as any, checkoutFn as any, "p1");

    expect(res.url).toBe("https://jfeffect.com/pay/AbC123xyz789");
    expect(res.url).not.toContain("checkout.stripe.com");
    expect(res.url).not.toContain("#");
    expect(res.url.split("\n")).toHaveLength(1);
    expect(res.url.trim()).toBe(res.url);
    expect(decodeURIComponent(res.url)).toBe(res.url); // no double encoding
    expect(isMessageSafeUrl(res.url)).toBe(true);
    expect(res.canonicalUrl).toBe(GIANT_CHECKOUT_URL); // admin "Open" keeps Stripe
    expect(checkoutFn).not.toHaveBeenCalled(); // opening/copying creates no payment
  });

  it("passes reusable buy.stripe.com payment links straight through", async () => {
    const shareFn = vi.fn(async () => ({
      kind: "payment_link",
      shareUrl: "https://buy.stripe.com/8wM5nQ0aB",
      canonicalUrl: "https://buy.stripe.com/8wM5nQ0aB",
      needsFreshCheckout: false,
      label: "PT pack",
    }));
    const res = await getShareablePaymentUrl(shareFn as any, vi.fn() as any, "p2");
    expect(res.url).toBe("https://buy.stripe.com/8wM5nQ0aB");
    expect(isMessageSafeUrl(res.url)).toBe(true);
  });

  it("regenerates through the existing canonical flow when the session is stale, then returns the short URL", async () => {
    const shareFn = vi
      .fn()
      .mockResolvedValueOnce({ kind: "checkout_session", shareUrl: null, canonicalUrl: null, needsFreshCheckout: true, label: "x" })
      .mockResolvedValueOnce({
        kind: "checkout_session",
        shareUrl: "https://jfeffect.com/pay/ZzYyXxWw1234",
        canonicalUrl: GIANT_CHECKOUT_URL,
        needsFreshCheckout: false,
        label: "x",
      });
    const checkoutFn = vi.fn(async () => ({ url: GIANT_CHECKOUT_URL }));
    const res = await getShareablePaymentUrl(shareFn as any, checkoutFn as any, "p3");
    expect(checkoutFn).toHaveBeenCalledTimes(1); // one canonical regeneration, no duplicates
    expect(res.url).toBe("https://jfeffect.com/pay/ZzYyXxWw1234");
  });

  it("refuses to share a settled purchase", async () => {
    const shareFn = vi.fn(async () => ({ kind: "none", shareUrl: null, canonicalUrl: null, needsFreshCheckout: false, label: "x", reason: "Already settled" }));
    await expect(getShareablePaymentUrl(shareFn as any, vi.fn() as any, "p4")).rejects.toThrow("Already settled");
  });
});

describe("redirect + Stripe attribution contracts", () => {
  const routeSrc = readFileSync("src/routes/pay.$token.tsx", "utf8");
  const serverSrc = readFileSync("src/lib/payment-share.server.ts", "utf8");
  const checkoutSrc = readFileSync("src/lib/stripe-checkout.functions.ts", "utf8");

  it("short URL responds with an HTTP redirect to the exact resolved URL", () => {
    expect(routeSrc).toContain("status: 302");
    expect(routeSrc).toContain("Location: result.url");
    // The destination is used verbatim — no re-encoding, truncation or rebuilding.
    expect(routeSrc).not.toMatch(/encodeURI|slice\(|split\("#"\)/);
  });

  it("token resolution performs no Stripe writes and creates no payment", () => {
    const block = serverSrc.slice(serverSrc.indexOf("export async function resolveShareToken"));
    expect(block).not.toMatch(/method:\s*"POST"/);
    expect(block).not.toMatch(/checkout\/sessions",/);
    expect(block).not.toMatch(/\.insert\(/);
    expect(block).toContain("stripeGet");
  });

  it("invalid or revoked tokens fail safe with 404 and leak nothing", () => {
    const block = serverSrc.slice(serverSrc.indexOf("export async function resolveShareToken"));
    expect(block).toContain("isValidShareToken");
    expect(block).toContain("status: 404");
    expect(block).toContain("This payment link is not valid.");
  });

  it("settled purchases are never redirected to checkout", () => {
    const block = serverSrc.slice(serverSrc.indexOf("export async function resolveShareToken"));
    expect(block).toContain("already settled");
  });

  it("Stripe Checkout Session metadata for webhook attribution is untouched", () => {
    expect(checkoutSrc).toContain('metadata[purchase_record_id]');
    expect(checkoutSrc).toContain('sessionParams["metadata[client_id]"]');
  });
});
