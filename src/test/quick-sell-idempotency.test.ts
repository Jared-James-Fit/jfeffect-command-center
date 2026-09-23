import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findReusablePurchaseIntent, isSettledSale } from "@/lib/purchase-idempotency";

describe("payment requests reuse the same unpaid sale", () => {
  const quickSell = readFileSync("src/components/clients/quick-sell-sheet.tsx", "utf8");
  const assign = readFileSync("src/components/assign-offer-dialog.tsx", "utf8");

  it("checks for a reusable intent before inserting", () => {
    expect(quickSell.indexOf("findReusablePurchaseIntent(")).toBeLessThan(quickSell.indexOf(".insert({"));
    expect(quickSell).toContain("getShareablePaymentUrl(");
    expect(assign.indexOf("findReusablePurchaseIntent(")).toBeLessThan(assign.indexOf(".insert(payload"));
    expect(assign).toContain("getShareablePaymentUrl(");
  });

  it("treats an unpaid Checkout Session as the same open intent", () => {
    const rows = [
      {
        id: "open",
        client_id: "c",
        offer_id: "o",
        payment_status: "Pending Payment",
        stripe_checkout_session_id: "cs_live_open",
        amount_paid: 0,
        amount_paid_cents: 0,
        created_at: "2026-02-01",
      },
      {
        id: "paid",
        client_id: "c",
        offer_id: "o",
        payment_status: "Paid",
        amount_paid: 65,
        stripe_checkout_session_id: "cs_live_paid",
        created_at: "2026-01-01",
      },
    ];
    expect(isSettledSale(rows[0]!)).toBe(false);
    expect(findReusablePurchaseIntent(rows, { clientId: "c", offerId: "o" })?.id).toBe("open");
    expect(isSettledSale(rows[1]!)).toBe(true);
  });

  it("never reuses archived or financially settled rows", () => {
    const rows = [
      { id: "archived", client_id: "c", offer_id: "o", payment_status: "Pending", archived_at: "2026-09-23", created_at: "2026-03-01" },
      { id: "pi", client_id: "c", offer_id: "o", payment_status: "Pending", stripe_payment_intent_id: "pi_paid", created_at: "2026-02-01" },
      { id: "sub", client_id: "c", offer_id: "o", payment_status: "Pending", stripe_subscription_id: "sub_live", created_at: "2026-01-01" },
    ];
    expect(findReusablePurchaseIntent(rows, { clientId: "c", offerId: "o" })).toBeNull();
  });

  it("does not pre-create a second checkout before resolving the existing share link", () => {
    const block = quickSell.slice(quickSell.indexOf("const sendCheckout"));
    const shareAt = block.indexOf("getShareablePaymentUrl(");
    expect(shareAt).toBeGreaterThan(0);
    expect(block.slice(0, shareAt)).not.toContain("await checkoutFn(");
  });
});
