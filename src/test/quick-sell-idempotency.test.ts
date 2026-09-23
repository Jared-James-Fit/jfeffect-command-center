import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findReusablePurchaseIntent } from "@/lib/purchase-idempotency";

describe("quick sell reuses the same unpaid sale", () => {
  const src = readFileSync("src/components/clients/quick-sell-sheet.tsx", "utf8");
  it("checks for a reusable intent before inserting and verifies the Stripe session", () => {
    expect(src.indexOf("findReusablePurchaseIntent(")).toBeLessThan(src.indexOf(".insert({"));
    expect(src).toContain("checkout?.sessionId");
    expect(src).toContain("getShareablePaymentUrl(");
  });
  it("treats a plain Pending row without Stripe money as reusable, never a paid one", () => {
    const rows = [
      { id: "a", client_id: "c", offer_id: "o", payment_status: "Pending", created_at: "2026-01-01" },
      { id: "b", client_id: "c", offer_id: "o", payment_status: "Pending", amount_paid: 65, created_at: "2026-02-01" },
    ];
    expect(findReusablePurchaseIntent(rows, { clientId: "c", offerId: "o" })?.id).toBe("a");
  });
});
