/**
 * What a monthly coaching package needs in Stripe before it can be sold, and
 * how to tell it's right (pure, tested; the Stripe calls are
 * stripe-setup.server.ts).
 *
 * A package is sold the way Complete Online Coaching is: a Stripe product with
 * one monthly price in CAD, the price before tax (`tax_behavior: exclusive`,
 * Stripe Tax adds GST/HST at checkout), found again by its lookup key so a
 * second run reuses it instead of making another, and one row in the app's
 * Products (`coaching_products`) that Add sale and the client's own checkout
 * read. Nothing here charges anyone or touches an existing price.
 */

export type SetupPackage = {
  slug: string;
  name: string;
  tagline: string | null;
  kind: string;
  price_cents: number;
  currency: string;
  billing_interval: string | null;
  features?: string[] | null;
};

/** The price's lookup key: the package, its period, its amount and currency, so a new price is a new key. */
export function packageLookupKey(p: Pick<SetupPackage, "slug" | "billing_interval" | "price_cents" | "currency">): string {
  return `jf_coaching_pkg_${p.slug}_${p.billing_interval ?? "month"}_${p.price_cents}_${p.currency.toLowerCase()}`;
}

/** Why a package can't have a monthly Stripe price set up here (null when it can). */
export function setupProblem(p: SetupPackage): string | null {
  if (p.kind !== "subscription") return `${p.name} isn't a monthly package.`;
  if ((p.billing_interval ?? "month") !== "month") return `${p.name} isn't billed monthly.`;
  if (!Number.isInteger(p.price_cents) || p.price_cents < 50) return `${p.name} has no price to charge.`;
  if (p.currency.toUpperCase() !== "CAD") return `${p.name} isn't priced in CAD.`;
  return null;
}

/** "$99" / "$249.50". */
export function dollars(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** The name it goes by in the app's Products and Add sale: "Nutrition Coaching — $99/month". */
export function productName(p: Pick<SetupPackage, "name" | "price_cents">): string {
  return `${p.name} — ${dollars(p.price_cents)}/month`;
}

export type StripePriceLike = {
  id: string;
  active?: boolean;
  unit_amount?: number | null;
  currency?: string | null;
  tax_behavior?: string | null;
  lookup_key?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
  product?: string | { id: string; active?: boolean } | null;
};

/** Everything about a Stripe price that doesn't match the package (empty = it's right). */
export function priceProblems(price: StripePriceLike | null | undefined, p: SetupPackage): string[] {
  if (!price) return ["No Stripe price."];
  const out: string[] = [];
  if (price.active === false) out.push("The Stripe price is archived.");
  if (price.unit_amount !== p.price_cents) {
    out.push(`Stripe charges ${dollars(price.unit_amount ?? 0)}, the package says ${dollars(p.price_cents)}.`);
  }
  if ((price.currency ?? "").toLowerCase() !== p.currency.toLowerCase()) {
    out.push(`Stripe's currency is ${(price.currency ?? "none").toUpperCase()}, not ${p.currency.toUpperCase()}.`);
  }
  if (price.recurring?.interval !== "month" || (price.recurring?.interval_count ?? 1) !== 1) {
    out.push("The Stripe price isn't monthly.");
  }
  if (price.tax_behavior !== "exclusive") out.push("The Stripe price isn't before tax (tax_behavior exclusive).");
  if (typeof price.product === "object" && price.product && price.product.active === false) {
    out.push("The Stripe product is archived.");
  }
  return out;
}

/** The app's Products row a package is sold through, shaped like Complete's ($130/month). */
export function productRowFor(p: SetupPackage, ids: { stripeProductId: string; stripePriceId: string }) {
  return {
    name: productName(p),
    description: p.tagline,
    price_cents: p.price_cents,
    currency: p.currency.toLowerCase(),
    stripe_product_id: ids.stripeProductId,
    stripe_price_id: ids.stripePriceId,
    stripe_payment_link_id: null,
    payment_link_url: null,
    product_type: "Coaching",
    payment_structure: "Monthly subscription",
    mode: "subscription",
    included_features: (p.features ?? []).slice(0, 40),
    agreement_required: false,
    agreement_before_service: false,
    status: "Active",
    active: true,
    sessions_included: 0,
    session_fulfillment: "first_payment",
    is_one_off: false,
    is_member_facing: false,
    notes: `Coaching package "${p.slug}" (Sales → Coaching packages). Sold through each client's own checkout; tax added by Stripe.`,
  };
}

/** The Stripe price to create (form fields), before tax, monthly, findable by its lookup key. */
export function priceParams(p: SetupPackage, stripeProductId: string): Record<string, string> {
  return {
    product: stripeProductId,
    unit_amount: String(p.price_cents),
    currency: p.currency.toLowerCase(),
    tax_behavior: "exclusive",
    "recurring[interval]": "month",
    "recurring[interval_count]": "1",
    lookup_key: packageLookupKey(p),
    "metadata[jf_package]": p.slug,
    "metadata[workspace]": "jfeffect",
  };
}

/**
 * A checkout made only to prove the price sells the way a client's does
 * (subscription, Stripe Tax, billing address, the agreement notice), then
 * expired at once: no customer, no sale, nothing anyone can pay.
 */
export function verificationCheckoutParams(
  priceId: string,
  slug: string,
  agreement: Readonly<Record<string, string>>,
  origin = "https://jfeffect.com",
): Record<string, string> {
  return {
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    success_url: `${origin}/coaching`,
    cancel_url: `${origin}/coaching`,
    allow_promotion_codes: "true",
    "automatic_tax[enabled]": "true",
    billing_address_collection: "required",
    "metadata[workspace]": "jfeffect",
    "metadata[purpose]": "package_setup_check",
    "metadata[jf_package]": slug,
    ...agreement,
  };
}
