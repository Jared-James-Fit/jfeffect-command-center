/**
 * Plan switching, part 2 (Nov 24 2026): coaching by approval, grandfathered
 * prices kept until the client consents, legacy subscriptions cancelled at the
 * end of their paid month, the Coaching Agreement before buying coaching, and
 * Stripe's billing page locked to billing details.
 */
import { describe, expect, it } from "vitest";
import {
  agreementNeeded,
  buildCatalog,
  currentPlanOf,
  forfeitText,
  historyLine,
  legacyMonthly,
  offerFromRow,
  offerTerms,
  PLAN_AGREEMENT_VERSION,
  transitionFor,
  type CatalogPackage,
  type CatalogProduct,
  type CoachingAccess,
  type PlanSale,
} from "@/lib/plans/plan-engine";
import { checkPortalConfig, portalConfigParams, readPortalSetting } from "@/lib/plans/billing-portal";
import { AGREEMENT_VERSION, RESIGN_REQUIRED_BELOW_VERSION } from "@/lib/coaching-agreement/version";
import { chatConfirmation, noticeCopy } from "@/lib/plans/plans.server";

const PACKAGES: CatalogPackage[] = [
  { id: "p-free", slug: "free", kind: "free", name: "Free app", price_cents: 0, status: "active", is_public: true, features: ["The full app"] },
  { id: "p-nut", slug: "nutrition", kind: "subscription", name: "Nutrition Coaching", price_cents: 9900, billing_interval: "month", status: "active", is_public: true, product_id: "prod-nut", features: ["A nutrition plan"] },
  { id: "p-comp", slug: "complete", kind: "subscription", name: "Complete Online Coaching", price_cents: 13000, billing_interval: "month", status: "active", is_public: true, product_id: "prod-comp", features: ["Everything in Nutrition Coaching", "A program"] },
  { id: "p-plus", slug: "plus", kind: "subscription", name: "Coaching Plus", price_cents: 24900, billing_interval: "month", status: "active", is_public: true, product_id: "prod-plus", included_calls: 2, features: ["Everything in Complete Online Coaching", "Calls"] },
];
const PRODUCTS: CatalogProduct[] = [
  { id: "prod-nut", price_cents: 9900, currency: "cad", stripe_price_id: "price_nut", mode: "subscription", active: true },
  { id: "prod-comp", price_cents: 13000, currency: "cad", stripe_price_id: "price_comp", mode: "subscription", active: true },
  { id: "prod-plus", price_cents: 24900, currency: "cad", stripe_price_id: "price_plus", mode: "subscription", active: true },
];
const catalog = buildCatalog(PACKAGES, PRODUCTS);
const to = (s: string) => catalog.find((o) => o.slug === s)!;
const sale = (over: Partial<PlanSale & { payment_frequency?: string }> = {}): PlanSale => ({
  id: "sale-1",
  offer_name: "Online Coaching — Legacy $65",
  stripe_subscription_id: "sub_1",
  stripe_subscription_status: "active",
  payment_status: "Active Subscription",
  next_billing_date: "2026-12-09",
  cancel_at_period_end: false,
  full_payable_amount: 65,
  ...over,
});
const fmt = (iso: string | null) => (iso ? `[${iso.slice(0, 10)}]` : null);

describe("coaching is sold by approval", () => {
  const free = currentPlanOf({ tier: "self_serve", enrollment: null, sale: null, catalog });
  const access = (a: CoachingAccess) => ({ coaching: a });

  it("a member who's never been coached applies first (and nothing is bought)", () => {
    expect(transitionFor(free, to("complete"))).toMatchObject({ kind: "apply", action: "apply", available: true });
    expect(transitionFor(free, to("complete"), access({ state: "applied", at: "2026-11-20" }))).toMatchObject({ kind: "apply", available: false, blocked: "Your application is with your coach" });
  });

  it("a former client asks to come back, and waits", () => {
    expect(transitionFor(free, to("plus"), access({ state: "comeback" }))).toMatchObject({ kind: "comeback", action: "comeback", available: true });
    expect(transitionFor(free, to("plus"), access({ state: "comeback_pending", at: "2026-11-20", changeId: "c1" }))).toMatchObject({ available: false, blocked: "Your request is with your coach" });
  });

  it("once approved they can pay, for the package the coach picked (or any)", () => {
    const any = access({ state: "approved", packageId: null, packageName: null, expiresAt: "2026-12-24" });
    expect(transitionFor(free, to("complete"), any)).toMatchObject({ kind: "start", action: "checkout", available: true });
    const onlyComp = access({ state: "approved", packageId: "p-comp", packageName: "Complete Online Coaching", expiresAt: "2026-12-24" });
    expect(transitionFor(free, to("complete"), onlyComp).available).toBe(true);
    expect(transitionFor(free, to("plus"), onlyComp)).toMatchObject({ available: false, blocked: "Your coach approved Complete Online Coaching" });
  });

  it("a coaching client switches packages without applying again", () => {
    const comp = currentPlanOf({ tier: "coaching", enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: null }, sale: sale({ full_payable_amount: 130 }), catalog });
    expect(transitionFor(comp, to("plus"), access({ state: "client" }))).toMatchObject({ kind: "upgrade", action: "swap_now" });
    expect(transitionFor(comp, to("nutrition"))).toMatchObject({ kind: "downgrade", action: "swap_later" });
  });

  it("free and membership move without anyone's approval", () => {
    expect(transitionFor(free, to("free")).available).toBe(false); // already there
    const comp = currentPlanOf({ tier: "coaching", enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: null }, sale: sale({ full_payable_amount: 130 }), catalog });
    expect(transitionFor(comp, to("free"))).toMatchObject({ kind: "cancel", action: "cancel_later", available: true });
  });
});

describe("grandfathered and custom prices", () => {
  it("a legacy monthly subscription can be cancelled at its period's end, never switched", () => {
    const c = currentPlanOf({ tier: "coaching", enrollment: null, sale: null, otherLiveSale: sale(), catalog });
    expect(c).toMatchObject({ managed: "custom", cancelable: true, grandfathered: true, priceCents: 6500, subscriptionId: "sub_1" });
    expect(transitionFor(c, to("free"))).toMatchObject({ kind: "cancel", action: "cancel_later", timing: "period_end", available: true });
    expect(transitionFor(c, to("plus"))).toMatchObject({ kind: "request", action: "request" });
    const ending = currentPlanOf({ tier: "coaching", enrollment: null, sale: null, otherLiveSale: sale({ cancel_at_period_end: true }), catalog });
    expect(ending.status).toBe("ending");
    expect(transitionFor(ending, to("free"))).toMatchObject({ available: false, blocked: "Your plan is already ending" });
  });

  it("never offers a cancel for a session package, a fixed term or anything not monthly", () => {
    expect(legacyMonthly(sale({ sessions_purchased: 16 }))).toBe(false);
    expect(legacyMonthly(sale({ is_fixed_term_commitment: true }))).toBe(false);
    expect(legacyMonthly({ ...sale(), payment_frequency: "Biweekly" } as any)).toBe(false);
    expect(legacyMonthly(sale({ stripe_subscription_status: "canceled" }))).toBe(false);
    const c = currentPlanOf({ tier: "coaching", enrollment: null, sale: null, otherLiveSale: sale({ sessions_purchased: 16 }), catalog });
    expect(c.cancelable).toBe(false);
    expect(transitionFor(c, to("free")).kind).toBe("request");
  });

  it("says, before anything changes, that their own price ends", () => {
    const special = currentPlanOf({ tier: "coaching", enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: 6500 }, sale: sale(), catalog });
    expect(special.grandfathered).toBe(true);
    expect(forfeitText(special)).toBe("I understand my current price of $65 a month is only kept on Complete Online Coaching, and switching or cancelling ends it for good.");
    const regular = currentPlanOf({ tier: "coaching", enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: null }, sale: sale({ full_payable_amount: 130 }), catalog });
    expect(forfeitText(regular)).toBeNull();
  });

  it("an offer says the new price, when it starts, that nothing is charged today, and that the old price ends", () => {
    const c = currentPlanOf({ tier: "coaching", enrollment: null, sale: null, otherLiveSale: sale(), catalog });
    const o = offerFromRow({ id: "o1", from_label: "Online Coaching — Legacy $65", from_price_cents: 6500, to_label: "Complete Online Coaching", to_price_cents: 13000, offer_timing: "period_end", offer_expires_at: "2026-12-08T00:00:00Z", note: null }, c);
    const t = offerTerms(o, fmt);
    expect(t.lines).toContain("Complete Online Coaching: $130 a month, plus tax.");
    expect(t.lines).toContain("It switches on [2026-12-09]. Nothing changes until then.");
    expect(t.lines.join(" ")).toMatch(/\$65 price is one you keep only on Online Coaching — Legacy \$65\. Accepting ends it/);
    expect(t.consentText).toBe("I accept Complete Online Coaching at $130 a month plus tax, switching on [2026-12-09]. My $65 price on Online Coaching — Legacy $65 ends.");
    const now = offerTerms({ ...o, timing: "now" }, fmt);
    expect(now.lines).toContain("It switches today. Nothing is charged or credited today; the new price starts on [2026-12-09].");
    const noSub = offerTerms({ ...o, hasSubscription: false }, fmt);
    expect(noSub.consentText).toMatch(/starting when you pay at checkout/);
  });

  it("history says what happened to offers and requests", () => {
    expect(historyLine({ id: "1", kind: "upgrade", status: "offered", from_label: "Legacy", to_label: "Complete", effective_at: null, created_at: "2026-11-24", offer_expires_at: "2026-12-08" }, fmt).title).toBe("Offer: Complete");
    expect(historyLine({ id: "2", kind: "reactivate", status: "requested", from_label: "Free app", to_label: "Complete", effective_at: null, created_at: "2026-11-24" }, fmt)).toEqual({ title: "Asked to come back to coaching", detail: "Sent to your coach" });
    expect(historyLine({ id: "3", kind: "reactivate", status: "cancelled", from_label: "Free app", to_label: "Complete", effective_at: null, created_at: "2026-11-24", decided_at: "2026-11-25", decision_note: "Full right now" }, fmt).detail).toBe("Declined: Full right now");
  });
});

describe("the Coaching Agreement comes before buying coaching", () => {
  const tr = { kind: "start" as const, action: "checkout" as const, timing: "after_payment" as const, available: true, blocked: null, configProblem: null };
  it("3.0 is published without asking earlier signers to sign again", () => {
    expect(AGREEMENT_VERSION).toBe("3.0");
    expect(PLAN_AGREEMENT_VERSION).toBe("3.0");
    expect(RESIGN_REQUIRED_BELOW_VERSION).toBe("2.0");
  });
  it("asks for 3.0 when they haven't accepted it, never for a move to free", () => {
    expect(agreementNeeded(tr, to("complete"), { version: null })).toEqual({ version: "3.0", signedVersion: null });
    expect(agreementNeeded(tr, to("complete"), { version: "2.4" })).toEqual({ version: "3.0", signedVersion: "2.4" });
    expect(agreementNeeded(tr, to("complete"), { version: "3.0" })).toBeNull();
    expect(agreementNeeded(tr, to("complete"), { version: null, exempt: true })).toBeNull();
    expect(agreementNeeded({ ...tr, kind: "cancel", action: "cancel_later" }, to("free"), { version: null })).toBeNull();
  });
});

describe("Stripe's billing page", () => {
  it("lets clients update their card and details and see invoices, and never change or cancel a plan", () => {
    const p = portalConfigParams();
    expect(p["features[subscription_update][enabled]"]).toBe("false");
    expect(p["features[subscription_cancel][enabled]"]).toBe("false");
    expect(p["features[payment_method_update][enabled]"]).toBe("true");
    expect(p["features[invoice_history][enabled]"]).toBe("true");
    expect(p.default_return_url).toBe("https://jfeffect.com/portal/plan");
    expect(p["business_profile[headline]"].length).toBeLessThanOrEqual(60); // Stripe refuses a longer one
  });
  it("flags a configuration that would let plans change in Stripe", () => {
    const ok = { active: true, features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true }, customer_update: { enabled: true }, subscription_cancel: { enabled: false }, subscription_update: { enabled: false } } };
    expect(checkPortalConfig(ok).ok).toBe(true);
    const loose = { ...ok, features: { ...ok.features, subscription_cancel: { enabled: true }, subscription_update: { enabled: true } } };
    expect(checkPortalConfig(loose).problems).toEqual(["clients can cancel in Stripe (plans must change in the app)", "clients can switch plans in Stripe (plans must change in the app)"]);
  });
  it("reads the saved configuration ids and ignores anything else", () => {
    expect(readPortalSetting('{"test":"bpc_123","live":"bpc_456"}')).toEqual({ test: "bpc_123", live: "bpc_456" });
    expect(readPortalSetting('{"live":"nope"}')).toEqual({});
    expect(readPortalSetting("not json")).toEqual({});
  });
});

describe("confirmations", () => {
  it("a coaching client gets a chat message in their coach's words for what they confirmed", () => {
    expect(chatConfirmation({ kind: "downgrade", to_label: "Nutrition Coaching", to_family: "coaching", to_price_cents: 9900, from_label: "Complete Online Coaching", effective_at: "2026-12-09" }, "scheduled")).toMatch(
      /^Confirmed: you're moving to Nutrition Coaching on .+\. It's \$99 a month plus tax\. Nothing changes until then/,
    );
    expect(chatConfirmation({ kind: "cancel", to_family: "free", from_label: "Complete Online Coaching", effective_at: "2026-12-09" }, "scheduled")).toMatch(/^Confirmed: Complete Online Coaching ends /);
    expect(chatConfirmation({ kind: "upgrade", to_label: "Coaching Plus", to_family: "coaching", to_price_cents: 24900 }, "started")).toBe("Your plan is now Coaching Plus. It's $249 a month plus tax.");
    expect(chatConfirmation({ kind: "upgrade" }, "requested")).toBeNull();
  });
  it("tells the client about an approval and an offer, and the coach about a request to come back", () => {
    expect(noticeCopy({ kind: "approve", to_label: "Complete Online Coaching" }, "approved", "Sam").client?.title).toBe("You're approved for coaching");
    expect(noticeCopy({ kind: "upgrade", to_label: "Complete Online Coaching" }, "offered", "Sam").client?.body).toMatch(/Nothing changes unless you accept/);
    expect(noticeCopy({ kind: "reactivate", to_label: "Complete Online Coaching" }, "comeback_requested", "Sam").admin.title).toBe("Sam asked to come back to coaching (Complete Online Coaching)");
  });
});
