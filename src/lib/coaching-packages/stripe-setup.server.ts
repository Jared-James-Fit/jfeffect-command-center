/**
 * Sets up a monthly coaching package for sale in Stripe, and proves it
 * (stripe-setup.ts has the rules). Run from the `coaching-package-stripe` hook:
 * a preview unless `apply` is true. For each package:
 *
 *   1. its Stripe price, found by lookup key (or created: a product named for the
 *      package and one monthly CAD price before tax), never an edit of one;
 *   2. its row in the app's Products, found by that price (or inserted);
 *   3. the package pointing at that row (`coaching_packages.product_id`);
 *   4. verified: the price read back from Stripe, and a subscription checkout
 *      with Stripe Tax made and expired straight away, so nothing can be paid.
 *
 * It never changes a package's status or whether it's on the site, never edits
 * an existing Stripe price or product, and never touches a sale.
 */
import { formEncode, stripeFetch, detectStripeKeyMode } from "@/lib/stripe.server";
import { AGREEMENT_CHECKOUT_PARAMS } from "@/lib/coaching-agreement/checkout-notice";
import {
  packageLookupKey,
  priceParams,
  priceProblems,
  productRowFor,
  setupProblem,
  verificationCheckoutParams,
  type SetupPackage,
  type StripePriceLike,
} from "./stripe-setup";

type Db = any;

export type PackageSetupReport = {
  slug: string;
  ok: boolean;
  problems: string[];
  lookupKey?: string;
  price?: { id: string; amount: number | null; currency: string | null; interval: string | null; taxBehavior: string | null; created: boolean };
  stripeProductId?: string;
  productRowId?: string | null;
  productRowCreated?: boolean;
  linked?: boolean;
  checkout?: { ok: boolean; sessionId?: string; subtotal?: number | null; automaticTax?: boolean; expired?: boolean; error?: string };
};

async function readPrice(id: string): Promise<StripePriceLike | null> {
  try {
    return await stripeFetch(`/prices/${encodeURIComponent(id)}?expand[]=product`);
  } catch {
    return null;
  }
}

async function findByLookup(key: string): Promise<StripePriceLike | null> {
  const found = await stripeFetch(
    `/prices?active=true&limit=1&lookup_keys[]=${encodeURIComponent(key)}&expand[]=data.product`,
  );
  return (found?.data?.[0] as StripePriceLike) ?? null;
}

function productIdOf(price: StripePriceLike): string | null {
  const p = price.product;
  return typeof p === "string" ? p : (p?.id ?? null);
}

async function checkCheckout(priceId: string, slug: string): Promise<NonNullable<PackageSetupReport["checkout"]>> {
  try {
    const session = await stripeFetch("/checkout/sessions", {
      method: "POST",
      body: formEncode(verificationCheckoutParams(priceId, slug, AGREEMENT_CHECKOUT_PARAMS)),
    });
    let expired = false;
    try {
      const done = await stripeFetch(`/checkout/sessions/${encodeURIComponent(session.id)}/expire`, { method: "POST" });
      expired = done?.status === "expired";
    } catch {
      expired = false;
    }
    return {
      ok: !!session?.id && session?.mode === "subscription" && expired,
      sessionId: session.id,
      subtotal: session.amount_subtotal ?? null,
      automaticTax: !!session.automatic_tax?.enabled,
      expired,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export async function setupPackageStripe(
  db: Db,
  opts: { slugs: string[]; apply: boolean; checkout?: boolean },
): Promise<{ mode: string | null; apply: boolean; packages: PackageSetupReport[] }> {
  const mode = detectStripeKeyMode(process.env.STRIPE_SECRET_KEY ?? null);
  const out: PackageSetupReport[] = [];

  for (const slug of opts.slugs) {
    const { data: pkg, error } = await db
      .from("coaching_packages")
      .select("id, slug, name, tagline, kind, price_cents, currency, billing_interval, features, product_id")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !pkg) {
      out.push({ slug, ok: false, problems: [error?.message ?? "No such package."] });
      continue;
    }
    const p = pkg as SetupPackage & { id: string; product_id: string | null };
    const problem = setupProblem(p);
    if (problem) {
      out.push({ slug, ok: false, problems: [problem] });
      continue;
    }
    const report: PackageSetupReport = { slug, ok: false, problems: [], lookupKey: packageLookupKey(p) };

    // 1. The Stripe price: the one the package already sells through, else by lookup key, else new.
    let price: StripePriceLike | null = null;
    let created = false;
    if (p.product_id) {
      const { data: row } = await db.from("coaching_products").select("stripe_price_id").eq("id", p.product_id).maybeSingle();
      if (row?.stripe_price_id) price = await readPrice(row.stripe_price_id);
      if (price && priceProblems(price, p).length) price = null; // doesn't match: look for the right one
    }
    if (!price) price = await findByLookup(report.lookupKey!);
    if (!price && opts.apply) {
      const idem = `jf-coaching-pkg-${slug}-${p.price_cents}-${p.currency.toLowerCase()}`;
      const product = await stripeFetch("/products", {
        method: "POST",
        idempotencyKey: `${idem}-product`,
        body: formEncode({
          name: p.name,
          ...(p.tagline ? { description: p.tagline } : {}),
          "metadata[jf_package]": slug,
          "metadata[workspace]": "jfeffect",
        }),
      });
      await stripeFetch("/prices", {
        method: "POST",
        idempotencyKey: `${idem}-price`,
        body: formEncode(priceParams(p, product.id)),
      });
      price = await findByLookup(report.lookupKey!);
      created = true;
    }
    if (!price) {
      report.problems.push(opts.apply ? "Stripe didn't return the new price." : "No Stripe price yet (runs with apply).");
      out.push(report);
      continue;
    }
    const stripeProductId = productIdOf(price);
    report.stripeProductId = stripeProductId ?? undefined;
    report.price = {
      id: price.id,
      amount: price.unit_amount ?? null,
      currency: price.currency ?? null,
      interval: price.recurring?.interval ?? null,
      taxBehavior: price.tax_behavior ?? null,
      created,
    };
    report.problems.push(...priceProblems(price, p));

    // 2. The app's Products row for that price.
    const { data: rows } = await db
      .from("coaching_products")
      .select("id, status, active")
      .eq("stripe_price_id", price.id)
      .neq("status", "Archived")
      .order("created_at", { ascending: true })
      .limit(1);
    let rowId: string | null = rows?.[0]?.id ?? null;
    report.productRowCreated = false;
    if (!rowId && opts.apply && stripeProductId) {
      const { data: inserted, error: insErr } = await db
        .from("coaching_products")
        .insert(productRowFor(p, { stripeProductId, stripePriceId: price.id }))
        .select("id")
        .single();
      if (insErr) report.problems.push(`Products row: ${insErr.message}`);
      rowId = inserted?.id ?? null;
      report.productRowCreated = !!rowId;
    }
    report.productRowId = rowId;
    if (!rowId) report.problems.push(opts.apply ? "No Products row." : "No Products row yet (runs with apply).");

    // 3. The package sells through it.
    report.linked = !!rowId && p.product_id === rowId;
    if (rowId && !report.linked && opts.apply) {
      const { error: linkErr } = await db.from("coaching_packages").update({ product_id: rowId }).eq("id", p.id);
      if (linkErr) report.problems.push(`Linking the package: ${linkErr.message}`);
      else report.linked = true;
    }
    if (!report.linked && opts.apply) report.problems.push("The package doesn't point at its product.");

    // 4. A checkout the way a client's is made, expired straight away.
    if (opts.checkout !== false && report.problems.length === 0) {
      report.checkout = await checkCheckout(price.id, slug);
      if (!report.checkout.ok) report.problems.push(`Checkout check failed${report.checkout.error ? `: ${report.checkout.error}` : ""}.`);
      else if (report.checkout.subtotal !== p.price_cents) report.problems.push("Checkout's subtotal isn't the package's price.");
      else if (!report.checkout.automaticTax) report.problems.push("Checkout didn't turn Stripe Tax on.");
    }

    report.ok = report.problems.length === 0 && (!opts.apply || !!report.linked);
    out.push(report);
  }
  return { mode, apply: opts.apply, packages: out };
}
