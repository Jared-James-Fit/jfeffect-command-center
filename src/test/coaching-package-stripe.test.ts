import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dollars,
  packageLookupKey,
  priceParams,
  priceProblems,
  productName,
  productRowFor,
  setupProblem,
  verificationCheckoutParams,
  type SetupPackage,
} from "@/lib/coaching-packages/stripe-setup";

const nutrition: SetupPackage = {
  slug: "nutrition",
  name: "Nutrition Coaching",
  tagline: "I run your nutrition. You run your training.",
  kind: "subscription",
  price_cents: 9900,
  currency: "CAD",
  billing_interval: "month",
  features: ["A nutrition plan built around the food you eat"],
};
const plus: SetupPackage = { ...nutrition, slug: "plus", name: "Coaching Plus", price_cents: 24900, tagline: "Complete coaching, plus time with me on video." };

const goodPrice = {
  id: "price_x",
  active: true,
  unit_amount: 9900,
  currency: "cad",
  tax_behavior: "exclusive",
  recurring: { interval: "month", interval_count: 1 },
  product: { id: "prod_x", active: true },
};

describe("a monthly package's Stripe setup (Nov 23 2026)", () => {
  it("finds its price again by a key that names the package, period, amount and currency", () => {
    expect(packageLookupKey(nutrition)).toBe("jf_coaching_pkg_nutrition_month_9900_cad");
    expect(packageLookupKey(plus)).toBe("jf_coaching_pkg_plus_month_24900_cad");
    // a new price is a new key, never an edit of the old one
    expect(packageLookupKey({ ...plus, price_cents: 25900 })).not.toBe(packageLookupKey(plus));
  });

  it("only sets up a monthly CAD package with a price", () => {
    expect(setupProblem(nutrition)).toBeNull();
    expect(setupProblem({ ...nutrition, kind: "free", price_cents: 0 })).toMatch(/isn't a monthly package/);
    expect(setupProblem({ ...nutrition, kind: "one_time", billing_interval: "once" })).toMatch(/monthly package/);
    expect(setupProblem({ ...nutrition, price_cents: 0 })).toMatch(/no price/);
    expect(setupProblem({ ...nutrition, currency: "USD" })).toMatch(/CAD/);
  });

  it("creates a before-tax monthly price, never one that includes tax", () => {
    const p = priceParams(plus, "prod_plus");
    expect(p).toMatchObject({
      product: "prod_plus",
      unit_amount: "24900",
      currency: "cad",
      tax_behavior: "exclusive",
      "recurring[interval]": "month",
      "recurring[interval_count]": "1",
      lookup_key: "jf_coaching_pkg_plus_month_24900_cad",
      "metadata[jf_package]": "plus",
    });
  });

  it("says exactly what about a Stripe price doesn't match", () => {
    expect(priceProblems(goodPrice, nutrition)).toEqual([]);
    expect(priceProblems(null, nutrition)).toEqual(["No Stripe price."]);
    expect(priceProblems({ ...goodPrice, unit_amount: 13000 }, nutrition)).toEqual(["Stripe charges $130, the package says $99."]);
    expect(priceProblems({ ...goodPrice, tax_behavior: "inclusive" }, nutrition)[0]).toMatch(/before tax/);
    expect(priceProblems({ ...goodPrice, recurring: { interval: "week", interval_count: 2 } }, nutrition)[0]).toMatch(/monthly/);
    expect(priceProblems({ ...goodPrice, active: false }, nutrition)[0]).toMatch(/archived/);
    expect(priceProblems({ ...goodPrice, product: { id: "prod_x", active: false } }, nutrition)[0]).toMatch(/product is archived/);
  });

  it("makes the Products row the way Complete's $130/month is made", () => {
    const row = productRowFor(plus, { stripeProductId: "prod_plus", stripePriceId: "price_plus" });
    expect(row).toMatchObject({
      name: "Coaching Plus — $249/month",
      price_cents: 24900,
      currency: "cad",
      mode: "subscription",
      payment_structure: "Monthly subscription",
      product_type: "Coaching",
      status: "Active",
      active: true,
      payment_link_url: null,
      is_one_off: false,
      is_member_facing: false,
    });
    expect(productName(nutrition)).toBe("Nutrition Coaching — $99/month");
    expect(dollars(24950)).toBe("$249.50");
  });

  it("proves the price sells like a client's checkout, then the checkout can't be used", () => {
    const c = verificationCheckoutParams("price_plus", "plus", { "custom_text[submit][message]": "By paying…" });
    expect(c).toMatchObject({
      mode: "subscription",
      "automatic_tax[enabled]": "true",
      billing_address_collection: "required",
      "line_items[0][price]": "price_plus",
      "metadata[purpose]": "package_setup_check",
      "custom_text[submit][message]": "By paying…",
    });
    // no customer, no sale: nothing on it to charge or record
    expect(Object.keys(c).some((k) => /customer|purchase_record|client_id/.test(k))).toBe(false);
    const server = readFileSync("src/lib/coaching-packages/stripe-setup.server.ts", "utf8");
    expect(server).toContain("/expire`");
    // it never edits a price or a package's listing
    expect(server).not.toMatch(/prices\/\$\{[^}]+\}", \{\s*method: "POST"/);
    expect(server).not.toMatch(/is_public|status:\s*"active"/);
  });

  it("a preview makes nothing in Stripe", () => {
    const hook = readFileSync("src/routes/api/public/hooks/coaching-package-stripe.ts", "utf8");
    expect(hook).toContain("authorizeHookRequest");
    expect(hook).toContain('checkout: body?.checkout === true || (body?.apply === true && body?.checkout !== false)');
    const server = readFileSync("src/lib/coaching-packages/stripe-setup.server.ts", "utf8");
    expect(server).toContain("if (!price && opts.apply)");
    expect(server).toContain("if (!rowId && opts.apply && stripeProductId)");
  });

  it("lists Nutrition and Plus only once each sells through a matching Stripe price", () => {
    const sql = readFileSync("supabase/migrations/20270514090000_four_options_live.sql", "utf8");
    const publish = sql.slice(sql.indexOf("UPDATE public.coaching_packages p SET"), sql.indexOf("-- 2."));
    expect(publish).toContain("p.slug IN ('nutrition', 'plus')");
    expect(publish).toContain("AND p.status = 'draft'");
    // the link the hook makes, matching the package's own price and currency
    expect(publish).toContain("cp.id = p.product_id");
    expect(publish).toContain("cp.stripe_price_id IS NOT NULL");
    expect(publish).toContain("cp.price_cents = p.price_cents");
    expect(publish).toContain("lower(cp.currency) = lower(p.currency)");
    expect(publish).toContain("cp.mode = 'subscription'");
    // never the one-time calls, never a sale
    expect(sql.match(/slug IN \(([^)]*)\)/g)).toEqual(["slug IN ('nutrition', 'plus')"]);
    expect(sql).not.toMatch(/purchase_records|stripe_subscription|coaching_package_enrollments/);
  });

  it("only moves Complete to 'Everything in Nutrition Coaching' once Nutrition is listed, and only from its current words", () => {
    const sql = readFileSync("supabase/migrations/20270514090000_four_options_live.sql", "utf8");
    const complete = sql.slice(sql.indexOf("UPDATE public.coaching_packages c SET"));
    expect(complete).toContain("'Everything in Nutrition Coaching'");
    expect(complete).toContain("n.slug = 'nutrition' AND n.status = 'active' AND n.is_public");
    expect(complete).toContain("AND c.features = ARRAY[");
    // the new list keeps every other line Complete had, and drops only the one Nutrition already says
    const after = complete.slice(complete.indexOf("features = ARRAY["), complete.indexOf("]")).match(/'([^']+)'/g)!;
    expect(after).toHaveLength(6);
    expect(after).not.toContain("'A nutrition plan built around the food you eat'");
  });
});
