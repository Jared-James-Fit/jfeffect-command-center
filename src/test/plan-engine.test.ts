import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  configIssues,
  configProblem,
  currentPlanOf,
  expandFeatures,
  featureDiff,
  quoteLines,
  saleIsLive,
  transitionFor,
  visibleOptions,
  type CatalogPackage,
  type CatalogProduct,
  type PlanSale,
} from "@/lib/plans/plan-engine";
import {
  previewParams,
  readPreview,
  subProblem,
  subState,
  swapLaterParams,
  swapNowParams,
  upgradeOutcome,
  usableProrationDate,
} from "@/lib/plans/plan-stripe";

// The packages as they are in production on Nov 23 2026 (features verbatim).
const PACKAGES: CatalogPackage[] = [
  {
    id: "p-free", slug: "free", kind: "free", name: "Free app", price_cents: 0, status: "active", is_public: true, sort_order: 0,
    features: ["My programs, or build or upload your own", "Every set, PR and progression logged", "2,000+ exercises with how-to videos", "Calories, macros, a meal plan and a food log", "The Crew and a monthly League"],
  },
  {
    id: "p-nut", slug: "nutrition", kind: "subscription", name: "Nutrition Coaching", price_cents: 9900, currency: "CAD", billing_interval: "month", status: "active", is_public: true, product_id: "prod-nut",
    features: ["A nutrition plan built around the food you eat", "Calories and macros set for your goal", "Nutrition check-ins with my feedback", "Adjusted as your bodyweight moves", "The full app for your own training"],
  },
  {
    id: "p-comp", slug: "complete", kind: "subscription", name: "Complete Online Coaching", price_cents: 13000, currency: "CAD", billing_interval: "month", status: "active", is_public: true, recommended: true, product_id: "prod-comp",
    features: ["Everything in Nutrition Coaching", "A program written for you and changed as you progress", "Weekly check-ins, and I adjust the plan", "Technique feedback on the sets you film", "Message me in the app", "Meet prep if you compete"],
  },
  {
    id: "p-plus", slug: "plus", kind: "subscription", name: "Coaching Plus", price_cents: 24900, currency: "CAD", billing_interval: "month", status: "active", is_public: true, product_id: "prod-plus", included_calls: 2,
    features: ["Everything in Complete Online Coaching", "Two private 30-minute video calls each billing month"],
  },
  { id: "p-tech", slug: "technique-review", kind: "one_time", name: "Technique Review", price_cents: 7900, billing_interval: "once", status: "draft", features: [] },
];

const PRODUCTS: CatalogProduct[] = [
  { id: "prod-nut", price_cents: 9900, currency: "cad", stripe_price_id: "price_nut", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
  { id: "prod-comp", price_cents: 13000, currency: "cad", stripe_price_id: "price_comp", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
  { id: "prod-plus", price_cents: 24900, currency: "cad", stripe_price_id: "price_plus", mode: "subscription", payment_structure: "Monthly subscription", active: true, archived: false },
];

const catalog = buildCatalog(PACKAGES, PRODUCTS);
const byslug = (s: string) => catalog.find((o) => o.slug === s)!;

const liveSale = (over: Partial<PlanSale> = {}): PlanSale => ({
  id: "sale-1",
  offer_name: "Online Coaching — $130/month",
  stripe_subscription_id: "sub_1",
  stripe_subscription_status: "active",
  payment_status: "Active Subscription",
  next_billing_date: "2026-12-09",
  cancel_at_period_end: false,
  full_payable_amount: 130,
  ...over,
});

describe("catalog", () => {
  it("orders free, then coaching by price, and drops one-time calls and drafts", () => {
    expect(catalog.map((o) => o.slug)).toEqual(["free", "nutrition", "complete", "plus"]);
    expect(catalog.map((o) => o.family)).toEqual(["free", "coaching", "coaching", "coaching"]);
  });

  it("spells out 'Everything in' from the packages themselves", () => {
    const plus = expandFeatures(PACKAGES[3], PACKAGES);
    expect(plus).toContain("A nutrition plan built around the food you eat");
    expect(plus).toContain("Message me in the app");
    expect(plus).toContain("Two private 30-minute video calls each billing month");
    expect(plus.some((l) => /^everything in/i.test(l))).toBe(false);
  });

  it("flags a package it can't sell instead of making a checkout", () => {
    expect(configProblem(PACKAGES[2], PRODUCTS[1])).toBeNull();
    expect(configProblem({ ...PACKAGES[2], product_id: null }, null)).toBe("Not linked to a Stripe product");
    expect(configProblem(PACKAGES[2], { ...PRODUCTS[1], stripe_price_id: null })).toBe("Its product has no Stripe price");
    expect(configProblem(PACKAGES[2], { ...PRODUCTS[1], price_cents: 12000 })).toBe("Its product's price doesn't match the package");
    expect(configProblem(PACKAGES[2], { ...PRODUCTS[1], mode: "payment", payment_structure: "One-time" })).toBe("Its product isn't a monthly subscription");
    expect(configProblem(PACKAGES[2], { ...PRODUCTS[1], archived: true })).toBe("Its Stripe product is archived");
    // a membership package with no product yet: shown to the admin, never to a member
    const membership: CatalogPackage = { id: "p-mem", slug: "membership", kind: "membership", name: "Membership", price_cents: 1500, billing_interval: "month", status: "active", is_public: true, features: ["Members' programs"] };
    const cat = buildCatalog([...PACKAGES, membership], PRODUCTS);
    expect(cat.find((o) => o.slug === "membership")?.problem).toBe("Not linked to a Stripe product");
    expect(configIssues(cat)).toEqual([{ slug: "membership", name: "Membership", problem: "Not linked to a Stripe product" }]);
    const free = currentPlanOf({ tier: "self_serve", enrollment: null, sale: null, catalog: cat });
    expect(visibleOptions(cat, free).map((o) => o.slug)).toEqual(["free", "nutrition", "complete", "plus"]);
  });

  it("ranks membership between free and coaching", () => {
    const membership: CatalogPackage = { id: "p-mem", slug: "membership", kind: "membership", name: "Membership", price_cents: 30000, billing_interval: "month", status: "active", features: [] };
    const cat = buildCatalog([...PACKAGES, membership], PRODUCTS);
    expect(cat.map((o) => o.slug)).toEqual(["free", "membership", "nutrition", "complete", "plus"]);
  });
});

describe("current plan", () => {
  it("a free member is on the free app", () => {
    const c = currentPlanOf({ tier: "self_serve", enrollment: null, sale: null, catalog });
    expect(c).toMatchObject({ family: "free", managed: "free", name: "Free app", priceCents: 0, status: "free" });
  });

  it("a client on Complete paid by a live subscription can switch themselves", () => {
    const c = currentPlanOf({
      tier: "coaching",
      enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: 13000 },
      sale: liveSale(),
      catalog,
    });
    expect(c).toMatchObject({ family: "coaching", managed: "stripe", name: "Complete Online Coaching", priceCents: 13000, status: "active", nextBillingDate: "2026-12-09", specialPrice: false });
  });

  it("a legacy $65 client (no package) asks their coach", () => {
    const c = currentPlanOf({
      tier: "coaching",
      enrollment: null,
      sale: null,
      otherLiveSale: liveSale({ offer_name: "Online Coaching — Legacy $65", full_payable_amount: 65 }),
      catalog,
    });
    expect(c.managed).toBe("custom");
    expect(c.name).toBe("Online Coaching — Legacy $65");
    expect(transitionFor(c, byslug("plus"))).toMatchObject({ kind: "request", action: "request", available: true });
  });

  it("a session package's auto-pay is never a plan the client can switch", () => {
    const c = currentPlanOf({
      tier: "coaching",
      enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-pt", contracted_price_cents: null },
      sale: liveSale({ id: "sale-pt", sessions_purchased: 16, offer_name: "Personal Training — 16 Sessions / 4 Weeks" }),
      catalog,
    });
    expect(c.managed).toBe("custom");
  });

  it("a fixed term goes through the coach", () => {
    const c = currentPlanOf({
      tier: "coaching",
      enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: null },
      sale: liveSale({ is_fixed_term_commitment: true }),
      catalog,
    });
    expect(c.managed).toBe("custom");
    expect(c.customReason).toMatch(/set term/);
  });

  it("a grandfathered price is kept and said", () => {
    const c = currentPlanOf({
      tier: "coaching",
      enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: 6500 },
      sale: liveSale({ full_payable_amount: 65 }),
      catalog,
    });
    expect(c).toMatchObject({ priceCents: 6500, specialPrice: true, managed: "stripe" });
  });

  it("reads live, ending and failing subscriptions", () => {
    expect(saleIsLive(liveSale())).toBe(true);
    expect(saleIsLive(liveSale({ stripe_subscription_status: "canceled" }))).toBe(false);
    expect(saleIsLive(liveSale({ archived_at: "2026-11-01" }))).toBe(false);
    const enr = { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: 13000 };
    expect(currentPlanOf({ tier: "coaching", enrollment: enr, sale: liveSale({ cancel_at_period_end: true }), catalog }).status).toBe("ending");
    expect(currentPlanOf({ tier: "coaching", enrollment: enr, sale: liveSale({ stripe_subscription_status: "past_due" }), catalog }).status).toBe("past_due");
  });
});

describe("transitions (every valid move)", () => {
  // a member the coach approved for coaching (the gate itself is plan-approvals.test.ts)
  const approved = { coaching: { state: "approved" as const, packageId: null, packageName: null, expiresAt: "2026-12-24T00:00:00Z" } };
  const free = currentPlanOf({ tier: "self_serve", enrollment: null, sale: null, catalog });
  const complete = currentPlanOf({ tier: "coaching", enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: 13000 }, sale: liveSale(), catalog });

  it("free → coaching is a checkout, effective once paid", () => {
    expect(transitionFor(free, byslug("complete"), approved)).toMatchObject({ kind: "start", action: "checkout", timing: "after_payment", available: true });
  });
  it("coaching → a bigger package is now, prorated", () => {
    expect(transitionFor(complete, byslug("plus"))).toMatchObject({ kind: "upgrade", action: "swap_now", timing: "now", available: true });
  });
  it("coaching → a smaller package waits for the paid month to end", () => {
    expect(transitionFor(complete, byslug("nutrition"))).toMatchObject({ kind: "downgrade", action: "swap_later", timing: "period_end", available: true });
  });
  it("coaching → free cancels at the period's end", () => {
    expect(transitionFor(complete, byslug("free"))).toMatchObject({ kind: "cancel", action: "cancel_later", timing: "period_end", available: true });
  });
  it("membership ↔ coaching and membership → free use the same moves", () => {
    const membership: CatalogPackage = { id: "p-mem", slug: "membership", kind: "membership", name: "Membership", price_cents: 1500, billing_interval: "month", status: "active", is_public: true, product_id: "prod-mem", features: [] };
    const cat = buildCatalog([...PACKAGES, membership], [...PRODUCTS, { id: "prod-mem", price_cents: 1500, currency: "cad", stripe_price_id: "price_mem", mode: "subscription", active: true }]);
    const mem = currentPlanOf({ tier: "self_serve", enrollment: { id: "e2", package_id: "p-mem", sale_id: "sale-2", contracted_price_cents: null }, sale: liveSale({ id: "sale-2", full_payable_amount: 15 }), catalog: cat });
    expect(mem.family).toBe("membership");
    const f = currentPlanOf({ tier: "self_serve", enrollment: null, sale: null, catalog: cat });
    const to = (s: string) => cat.find((o) => o.slug === s)!;
    expect(transitionFor(f, to("membership")).action).toBe("checkout");
    expect(transitionFor(mem, to("complete"), approved).action).toBe("swap_now");
    expect(transitionFor(mem, to("free")).action).toBe("cancel_later");
    const comp = currentPlanOf({ tier: "coaching", enrollment: { id: "e1", package_id: "p-comp", sale_id: "sale-1", contracted_price_cents: null }, sale: liveSale(), catalog: cat });
    expect(transitionFor(comp, to("membership")).action).toBe("swap_later");
  });
  it("blocks what would double-bill or confuse", () => {
    expect(transitionFor(complete, byslug("complete"))).toMatchObject({ kind: "current", available: false });
    expect(transitionFor(free, byslug("free"))).toMatchObject({ available: false });
    expect(transitionFor(complete, byslug("plus"), { open: { id: "c", status: "scheduled", kind: "downgrade", toName: "Nutrition Coaching", effectiveAt: null } })).toMatchObject({ available: false, blocked: "Undo your scheduled change first" });
    expect(transitionFor(complete, byslug("plus"), { open: { id: "c", status: "awaiting_payment", kind: "upgrade", toName: "Coaching Plus", effectiveAt: null } }).available).toBe(false);
    // an unfinished checkout never blocks starting again (the old one is expired)
    expect(transitionFor(free, byslug("plus"), { ...approved, open: { id: "c", status: "checkout", kind: "start", toName: "Coaching Plus", effectiveAt: null } }).available).toBe(true);
    const failing = { ...complete, status: "past_due" as const };
    expect(transitionFor(failing, byslug("plus"))).toMatchObject({ available: false, blocked: "Update your card first" });
    expect(transitionFor(failing, byslug("free")).available).toBe(true);
    const ending = { ...complete, status: "ending" as const };
    expect(transitionFor(ending, byslug("plus")).blocked).toBe("Keep your plan first to change it");
    expect(transitionFor(free, byslug("plus"), { ...approved, native: true })).toMatchObject({ available: false, blocked: "Not available in the app" });
    // a downgrade or a cancel doesn't charge, so it works in the phone app too
    expect(transitionFor(complete, byslug("free"), { native: true }).available).toBe(true);
    const broken = { ...byslug("plus"), problem: "Its product has no Stripe price" };
    expect(transitionFor(complete, broken)).toMatchObject({ available: false, blocked: "Not available yet", configProblem: "Its product has no Stripe price" });
  });
});

describe("gains and losses", () => {
  it("Complete → Plus gains the calls and loses nothing", () => {
    const d = featureDiff(byslug("complete").features, byslug("plus").features);
    expect(d.gain).toEqual(["Two private 30-minute video calls each billing month"]);
    expect(d.lose).toEqual([]);
  });
  it("Complete → Nutrition loses the training side, never 'the full app'", () => {
    const d = featureDiff(byslug("complete").features, byslug("nutrition").features);
    expect(d.lose).toContain("A program written for you and changed as you progress");
    expect(d.lose).toContain("Message me in the app");
    expect(d.gain).toEqual([]);
  });
  it("Nutrition → Free loses the coaching, not the app", () => {
    const base = byslug("free").features;
    const d = featureDiff(byslug("nutrition").features, byslug("free").features, base);
    expect(d.lose).not.toContain("The full app for your own training");
    expect(d.lose).toContain("A nutrition plan built around the food you eat");
    expect(d.gain).toEqual([]);
  });
  it("Free → Complete gains the coaching and never 'loses' the app's own lines", () => {
    const base = byslug("free").features;
    const d = featureDiff(byslug("free").features, byslug("complete").features, base);
    expect(d.lose).toEqual([]);
    expect(d.gain).toContain("A program written for you and changed as you progress");
    expect(d.gain).not.toContain("Every set, PR and progression logged");
  });
});

describe("money in words", () => {
  const day = (iso: string | null) => (iso ? `Dec ${Number(iso.slice(8))}` : null);
  it("an upgrade: today's prorated charge (tax in), then the new price", () => {
    const l = quoteLines({ kind: "upgrade", timing: "now", todayCents: 6342, todayTaxIncluded: true, nextCents: 26145, nextTaxIncluded: true, nextDate: "2026-12-09", effectiveDate: null, creditCents: 0 }, day);
    expect(l).toEqual({ today: "$63.42", forward: "$261.45 a month, from Dec 9", when: "Right away, once the payment goes through" });
  });
  it("a downgrade: nothing today, the lower price when the month ends", () => {
    const l = quoteLines({ kind: "downgrade", timing: "period_end", todayCents: 0, todayTaxIncluded: true, nextCents: 10395, nextTaxIncluded: true, nextDate: "2026-12-09", effectiveDate: "2026-12-09", creditCents: 0 }, day);
    expect(l.today).toBe("$0");
    expect(l.when).toBe("Dec 9, when your paid month ends");
  });
  it("a first checkout: tax at checkout", () => {
    const l = quoteLines({ kind: "start", timing: "after_payment", todayCents: 13000, todayTaxIncluded: false, nextCents: 13000, nextTaxIncluded: false, nextDate: null, effectiveDate: null, creditCents: 0 }, day);
    expect(l).toEqual({ today: "$130 + tax", forward: "$130 + tax a month", when: "As soon as your payment goes through" });
  });
  it("to free: nothing going forward", () => {
    expect(quoteLines({ kind: "cancel", timing: "period_end", todayCents: 0, todayTaxIncluded: true, nextCents: 0, nextTaxIncluded: true, nextDate: null, effectiveDate: "2026-12-09", creditCents: 0 }, day).forward).toBe("Nothing. It's free.");
  });
});

describe("Stripe calls", () => {
  const sub = {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    cancel_at_period_end: false,
    automatic_tax: { enabled: true },
    items: { data: [{ id: "si_1", price: { id: "price_comp" }, current_period_end: 1796860800 }] },
    latest_invoice: "in_1",
  };
  const s = subState(sub);

  it("reads the period from the item (API 2025-03-31)", () => {
    expect(s).toMatchObject({ itemId: "si_1", priceId: "price_comp", periodEnd: 1796860800, customer: "cus_1", pendingUpdate: false, itemCount: 1 });
    expect(subProblem(s)).toBeNull();
    expect(subProblem({ ...s, itemCount: 2 })).toMatch(/more than one item/);
    expect(subProblem({ ...s, status: "canceled" })).toMatch(/isn't active/);
    expect(subProblem({ ...s, pendingUpdate: true })).toMatch(/waiting on a payment/);
  });

  it("an upgrade only changes the price once its charge succeeds, at the previewed amount", () => {
    expect(swapNowParams(s, "price_plus", 1795000000)).toEqual({
      "items[0][id]": "si_1",
      "items[0][price]": "price_plus",
      proration_behavior: "always_invoice",
      proration_date: "1795000000",
      payment_behavior: "pending_if_incomplete",
      "expand[0]": "latest_invoice",
    });
    expect(previewParams(s, "price_plus", "always_invoice", 1795000000)).toMatchObject({
      subscription: "sub_1",
      customer: "cus_1",
      "subscription_details[proration_behavior]": "always_invoice",
      "subscription_details[proration_date]": "1795000000",
    });
  });

  it("a downgrade charges nothing now", () => {
    expect(swapLaterParams(s, "price_nut")).toEqual({ "items[0][id]": "si_1", "items[0][price]": "price_nut", proration_behavior: "none" });
  });

  it("reads Stripe's preview (tax included, credits apart)", () => {
    expect(readPreview({ total: 6342, total_taxes: [{ amount: 302 }] })).toEqual({ totalCents: 6342, taxCents: 302, creditCents: 0 });
    expect(readPreview({ total: -1200, total_taxes: [] })).toEqual({ totalCents: 0, taxCents: 0, creditCents: 1200 });
  });

  it("never trusts a proration date from the phone beyond 20 minutes", () => {
    expect(usableProrationDate(1000, 1100)).toBe(1000);
    expect(usableProrationDate(1000, 1000 + 21 * 60)).toBe(1000 + 21 * 60);
    expect(usableProrationDate(5000, 1000)).toBe(1000);
    expect(usableProrationDate("x", 1000)).toBe(1000);
  });

  it("knows a paid upgrade from one waiting on the card", () => {
    const paid = { ...sub, items: { data: [{ id: "si_1", price: { id: "price_plus" } }] }, latest_invoice: { id: "in_2", status: "paid" } };
    expect(upgradeOutcome(paid, "price_plus").result).toBe("applied");
    const waiting = { ...sub, pending_update: { subscription_items: [] }, latest_invoice: { id: "in_3", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/x" } };
    expect(upgradeOutcome(waiting, "price_plus")).toEqual({ result: "needs_payment", invoiceId: "in_3", payUrl: "https://invoice.stripe.com/i/x" });
    expect(upgradeOutcome({ ...sub, latest_invoice: { id: "in_4", status: "void" } }, "price_plus").result).toBe("failed");
  });
});
