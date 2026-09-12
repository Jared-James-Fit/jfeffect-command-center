import { describe, it, expect } from "vitest";
import {
  assignEntitlementPreview,
  availableDeliveries,
  entitlementDeliveryLine,
  entitlementSummaryLine,
  hasSessionEntitlement,
  normalizeDelivery,
  readProductEntitlement,
} from "@/lib/product-sessions";
import { snapshotOfferForPurchase } from "@/lib/offers";

const product16 = {
  id: "p1",
  name: "16 Sessions (Final Payment)",
  sessions_included: 16,
  session_fulfillment: "first_payment",
  session_length_minutes: 60,
  session_expiry_days: 365,
};

describe("product session entitlement", () => {
  it("reads a real session count off a product row", () => {
    const e = readProductEntitlement(product16);
    expect(e.sessions).toBe(16);
    expect(e.delivery).toBe("first_payment");
    expect(e.lengthMinutes).toBe(60);
    expect(hasSessionEntitlement(product16)).toBe(true);
  });

  it("treats products with no sessions as non-session products", () => {
    expect(hasSessionEntitlement({ sessions_included: 0 })).toBe(false);
    expect(hasSessionEntitlement({})).toBe(false);
  });

  it("shows the session count in the live summary", () => {
    const e = readProductEntitlement(product16);
    expect(entitlementSummaryLine(e)).toBe("16 sessions included (60 min)");
    expect(entitlementDeliveryLine(e)).toBe("Added once the purchase is paid");
  });

  it("offers per-cycle delivery only for recurring products", () => {
    expect(availableDeliveries(false)).not.toContain("per_installment");
    expect(availableDeliveries(true)).toContain("per_installment");
    expect(normalizeDelivery("per_installment", false)).toBe("first_payment");
    expect(normalizeDelivery("per_installment", true)).toBe("per_installment");
  });

  it("grants nothing when a payment request is merely sent", () => {
    const p = assignEntitlementPreview(product16, "payment_request")!;
    expect(p.sessions).toBe(16);
    expect(p.grantedNow).toBe(0);
    expect(p.detail).toMatch(/after the client completes checkout/i);
  });

  it("grants nothing for a draft record", () => {
    expect(assignEntitlementPreview(product16, "draft")!.grantedNow).toBe(0);
  });

  it("grants immediately for an admin paid-in-full record", () => {
    expect(assignEntitlementPreview(product16, "paid_in_full")!.grantedNow).toBe(16);
  });

  it("never auto-grants a manual-delivery product", () => {
    const manual = { ...product16, session_fulfillment: "manual" };
    expect(assignEntitlementPreview(manual, "paid_in_full")!.grantedNow).toBe(0);
  });

  it("shows no entitlement block for products without sessions", () => {
    expect(assignEntitlementPreview({ sessions_included: 0 }, "payment_request")).toBeNull();
  });

  it("snapshots the entitlement onto the purchase so catalogue edits cannot rewrite it", () => {
    const snap: any = snapshotOfferForPurchase(
      { ...product16, sessions_included: 16, session_fulfillment: "first_payment" } as any,
      { clientId: "c1" },
    );
    expect(snap.sessions_purchased).toBe(16);
    expect(snap.package_tracking_enabled).toBe(true);
    expect(snap.session_fulfillment).toBe("first_payment");

    // Catalogue later changes to 20 — the old snapshot is untouched, the new
    // sale picks up the new number.
    const later: any = snapshotOfferForPurchase(
      { ...product16, sessions_included: 20 } as any,
      { clientId: "c2" },
    );
    expect(snap.sessions_purchased).toBe(16);
    expect(later.sessions_purchased).toBe(20);
  });

  it("carries per-cycle delivery into the sale snapshot", () => {
    const snap: any = snapshotOfferForPurchase(
      { ...product16, session_fulfillment: "per_installment" } as any,
      { clientId: "c1" },
    );
    expect(snap.session_fulfillment).toBe("per_installment");
  });

  it("defaults missing delivery to once-on-activation", () => {
    const snap: any = snapshotOfferForPurchase({ ...product16, session_fulfillment: null } as any, {
      clientId: "c1",
    });
    expect(snap.session_fulfillment).toBe("first_payment");
  });
});
