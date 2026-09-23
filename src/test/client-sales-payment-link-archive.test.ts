import { describe, expect, it } from "vitest";
import fs from "node:fs";

const sales = fs.readFileSync("src/components/admin/client-sales-table.tsx", "utf8");
const share = fs.readFileSync("src/components/payments/copy-payment-link-button.tsx", "utf8");
const archive = fs.readFileSync("src/lib/purchase-archive.functions.ts", "utf8");
const checkout = fs.readFileSync("src/lib/stripe-checkout.functions.ts", "utf8");

describe("client sales payment links and archive controls", () => {
  it("does not claim a payment request/link exists when Stripe has no destination", () => {
    expect(sales).toContain("Payment link not created. Use Create payment link to retry this sale.");
    expect(sales).toContain('linkReady ? "Copy payment link" : "Create payment link"');
  });

  it("creates checkout only on explicit copy/share and verifies it before minting the short link", () => {
    expect(share).toContain("const checkout = await checkoutFn");
    expect(share).toContain("checkout?.sessionId");
    expect(share).toContain("res = await shareFn");
  });


  it("verifies Stripe checkout persistence and repairs the sale link server-side when needed", () => {
    expect(checkout).toContain("const checkoutPatch = {");
    expect(checkout).toContain('.select("id, stripe_checkout_session_id, stripe_payment_link")');
    expect(checkout).toContain('await import("@/integrations/supabase/client.server")');
    expect(checkout).toContain("linkedPurchase.stripe_checkout_session_id !== session.id");
    expect(checkout).toContain("/expire");
  });

  it("exposes Current, Archived, and All views", () => {
    expect(sales).toContain('type ArchiveFilter = "current" | "archived" | "all"');
    expect(sales).toContain('<SelectItem value="archived">Archived</SelectItem>');
    expect(sales).toContain("raw.archived_at");
  });

  it("archives/restores without deleting financial history", () => {
    expect(archive).toContain("archived_at: now");
    expect(archive).toContain("archived_at: null");
    expect(sales).toContain("Archive sale");
    expect(sales).toContain("Restore sale");
  });

  it("only permits permanent removal for never-paid, never-linked assignments", () => {
    expect(archive).toContain("purchase.stripe_payment_intent_id || purchase.stripe_subscription_id || purchase.stripe_checkout_session_id");
    expect(archive).toContain('.from("payment_ledger")');
    expect(archive).toContain("This sale has transaction history and cannot be deleted. Archive it instead.");
    expect(sales).toContain("Remove unpaid sale");
  });
});