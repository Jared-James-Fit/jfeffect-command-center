import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STRIPE_API = "https://api.stripe.com/v1";

function getStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in project secrets.");
  return key;
}

function formEncode(params: Record<string, string | number | boolean | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  return usp.toString();
}

async function stripeFetch(path: string, init: { method?: string; body?: string } = {}) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${getStripeKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: init.body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe error (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

export const listCoachingProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("coaching_products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Sign image URLs (private bucket)
    const items = await Promise.all(
      (data ?? []).map(async (p: any) => {
        let signed: string | null = null;
        if (p.image_url) {
          const { data: s } = await supabase.storage
            .from("product-images")
            .createSignedUrl(p.image_url, 60 * 60);
          signed = s?.signedUrl ?? null;
        }
        return { ...p, image_signed_url: signed };
      })
    );
    return { items };
  });

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  details: z.string().trim().max(10000).optional().nullable(),
  priceCents: z.number().int().min(0).max(100_000_00),
  currency: z.string().trim().min(3).max(3).default("cad"),
  imagePath: z.string().trim().max(500).optional().nullable(),
  productType: z.string().trim().max(80).optional().nullable(),
  paymentStructure: z.string().trim().max(80).optional().nullable(),
  termLength: z.number().int().min(0).max(10000).optional().nullable(),
  termUnit: z.string().trim().max(40).optional().nullable(),
  includedFeatures: z.array(z.string().trim().min(1).max(200)).max(40).optional().default([]),
  agreementRequired: z.boolean().optional().default(false),
  agreementTemplateId: z.string().uuid().optional().nullable(),
  agreementBeforeService: z.boolean().optional().default(false),
  status: z.enum(["Active", "Draft", "Archived"]).optional().default("Active"),
  notes: z.string().trim().max(4000).optional().nullable(),
  pastedPaymentLinkUrl: z.string().url().max(2000).optional().nullable(),
  generateStripeLink: z.boolean().optional().default(false),
  // Stripe Checkout Session fields
  stripePriceId: z.string().trim().max(100).optional().nullable(),
  checkoutMode: z.enum(["payment", "subscription", "auto"]).optional().default("auto"),
  // Billing interval for subscription prices (used when auto-creating Stripe price)
  billingInterval: z.enum(["month", "year", "week", "day"]).optional().nullable(),
  // Access level (0-5) for display purposes
  accessLevel: z.number().int().min(0).max(5).optional().nullable(),
  isMemberFacing: z.boolean().optional(),
  memberTierLabel: z.string().trim().max(60).optional().nullable(),
});

export const createCoachingProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    let stripe_product_id: string | null = null;
    let stripe_price_id: string | null = null;
    let stripe_payment_link_id: string | null = null;
    let payment_link_url: string | null = data.pastedPaymentLinkUrl ?? null;

    if (data.generateStripeLink && data.priceCents >= 50) {
      const product = await stripeFetch("/products", {
        method: "POST",
        body: formEncode({
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
        }),
      });
      const isSubscription = data.checkoutMode === "subscription" || (data.checkoutMode !== "payment" && !!data.billingInterval);
      const priceParams: Record<string, string | number> = {
        product: product.id,
        unit_amount: data.priceCents,
        currency: data.currency.toLowerCase(),
      };
      if (isSubscription && data.billingInterval) {
        priceParams["recurring[interval]"] = data.billingInterval;
      }
      const price = await stripeFetch("/prices", {
        method: "POST",
        body: formEncode(priceParams),
      });
      const link = await stripeFetch("/payment_links", {
        method: "POST",
        body: formEncode({
          "line_items[0][price]": price.id,
          "line_items[0][quantity]": 1,
        }),
      });
      stripe_product_id = product.id;
      stripe_price_id = price.id;
      stripe_payment_link_id = link.id;
      payment_link_url = link.url;
    }

    const { data: row, error } = await supabase
      .from("coaching_products")
      .insert({
        name: data.name,
        description: data.description ?? null,
        details: data.details ?? null,
        price_cents: data.priceCents,
        currency: data.currency.toLowerCase(),
        image_url: data.imagePath ?? null,
        stripe_product_id,
        stripe_price_id: data.stripePriceId ?? stripe_price_id,
        stripe_payment_link_id,
        payment_link_url,
        product_type: data.productType ?? null,
        payment_structure: data.paymentStructure ?? null,
        term_length: data.termLength ?? null,
        term_unit: data.termUnit ?? null,
        included_features: data.includedFeatures ?? [],
        agreement_required: !!data.agreementRequired,
        agreement_template_id: data.agreementTemplateId ?? null,
        agreement_before_service: !!data.agreementBeforeService,
        status: data.status ?? "Active",
        active: (data.status ?? "Active") === "Active",
        notes: data.notes ?? null,
        mode: data.checkoutMode ?? (data.generateStripeLink ? "auto" : "manual"),
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { product: row };
  });

const updateSchema = createSchema.partial().extend({ id: z.string().uuid() });

export const updateCoachingProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    // Load existing row so we can detect currency changes and sync Stripe.
    const { data: existing, error: exErr } = await supabase
      .from("coaching_products").select("*").eq("id", data.id).maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (!existing) throw new Error("Product not found");
    const patch: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.details !== undefined) patch.details = data.details ?? null;
    if (data.priceCents !== undefined) patch.price_cents = data.priceCents;
    if (data.currency !== undefined) patch.currency = data.currency.toLowerCase();
    if (data.imagePath !== undefined) patch.image_url = data.imagePath ?? null;
    if (data.productType !== undefined) patch.product_type = data.productType ?? null;
    if (data.paymentStructure !== undefined) patch.payment_structure = data.paymentStructure ?? null;
    if (data.termLength !== undefined) patch.term_length = data.termLength ?? null;
    if (data.termUnit !== undefined) patch.term_unit = data.termUnit ?? null;
    if (data.includedFeatures !== undefined) patch.included_features = data.includedFeatures ?? [];
    if (data.agreementRequired !== undefined) patch.agreement_required = !!data.agreementRequired;
    if (data.agreementTemplateId !== undefined) patch.agreement_template_id = data.agreementTemplateId ?? null;
    if (data.agreementBeforeService !== undefined) patch.agreement_before_service = !!data.agreementBeforeService;
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.active = data.status === "Active";
      patch.archived = data.status === "Archived";
    }
    if (data.notes !== undefined) patch.notes = data.notes ?? null;
    if (data.pastedPaymentLinkUrl !== undefined) patch.payment_link_url = data.pastedPaymentLinkUrl ?? null;
    if (data.stripePriceId !== undefined) patch.stripe_price_id = data.stripePriceId ?? null;
    if (data.checkoutMode !== undefined) patch.mode = data.checkoutMode;

    // ── Stripe currency sync ───────────────────────────────────────────
    // Stripe Prices are immutable, so when the admin changes currency (or
    // amount) on a product that already has a Stripe product, we create a
    // brand-new Price in the new currency and archive the old one.
    const newCurrency = (patch.currency ?? existing.currency) as string;
    const newAmount = (patch.price_cents ?? existing.price_cents) as number;
    const oldCurrency = existing.currency as string;
    const oldAmount = existing.price_cents as number;
    const currencyChanged = newCurrency.toLowerCase() !== (oldCurrency ?? "").toLowerCase();
    const amountChanged = Number(newAmount) !== Number(oldAmount);
    const stripeProductId = existing.stripe_product_id as string | null;
    const userOverrodePriceId =
      data.stripePriceId !== undefined &&
      (data.stripePriceId ?? null) !== (existing.stripe_price_id ?? null);
    const warnings: string[] = [];
    if (stripeProductId && !userOverrodePriceId && (currencyChanged || amountChanged) && newAmount >= 50) {
      try {
        // Look up the old price to preserve recurring interval if any.
        let recurring: { interval: string; interval_count?: number } | null = null;
        if (existing.stripe_price_id) {
          try {
            const oldPrice = await stripeFetch(`/prices/${existing.stripe_price_id}`);
            if (oldPrice?.recurring) {
              recurring = {
                interval: oldPrice.recurring.interval,
                interval_count: oldPrice.recurring.interval_count,
              };
            }
          } catch (e: any) {
            warnings.push(`Lookup old price failed: ${e.message}`);
          }
        }
        const priceParams: Record<string, string | number> = {
          product: stripeProductId,
          unit_amount: newAmount,
          currency: newCurrency.toLowerCase(),
        };
        if (recurring) {
          priceParams["recurring[interval]"] = recurring.interval;
          if (recurring.interval_count) priceParams["recurring[interval_count]"] = recurring.interval_count;
        }
        const created = await stripeFetch("/prices", {
          method: "POST",
          body: formEncode(priceParams),
        });
        patch.stripe_price_id = created.id;
        if (existing.stripe_price_id) {
          try {
            await stripeFetch(`/prices/${existing.stripe_price_id}`, {
              method: "POST",
              body: formEncode({ active: false }),
            });
          } catch (e: any) {
            warnings.push(`Archive old price failed: ${e.message}`);
          }
        }
      } catch (e: any) {
        throw new Error(`Stripe sync failed: ${e.message}`);
      }
    }

    const { error } = await supabase.from("coaching_products").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, warnings, newStripePriceId: patch.stripe_price_id ?? null };
  });

export const duplicateCoachingProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { data: src, error: e1 } = await supabase.from("coaching_products").select("*").eq("id", data.id).single();
    if (e1 || !src) throw new Error(e1?.message ?? "Not found");
    const { id, created_at, updated_at, ...rest } = src as any;
    rest.name = `${src.name} (copy)`;
    rest.status = "Draft";
    rest.active = false;
    rest.created_by = userId;
    // Don't reuse Stripe IDs
    rest.stripe_product_id = null;
    rest.stripe_price_id = null;
    rest.stripe_payment_link_id = null;
    const { error } = await supabase.from("coaching_products").insert(rest);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCoachingProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: existing, error: selErr } = await supabase
      .from("coaching_products").select("*").eq("id", data.id).maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!existing) return { ok: true };

    // Best-effort deactivate in Stripe (Stripe doesn't allow hard delete of used products).
    const warnings: string[] = [];
    if (existing.stripe_payment_link_id) {
      try {
        await stripeFetch(`/payment_links/${existing.stripe_payment_link_id}`, {
          method: "POST",
          body: formEncode({ active: false }),
        });
      } catch (e: any) { warnings.push(`payment_link: ${e.message}`); }
    }
    if (existing.stripe_product_id) {
      try {
        await stripeFetch(`/products/${existing.stripe_product_id}`, {
          method: "POST",
          body: formEncode({ active: false }),
        });
      } catch (e: any) { warnings.push(`product: ${e.message}`); }
    }
    if (existing.image_url) {
      try { await supabase.storage.from("product-images").remove([existing.image_url]); } catch {}
    }

    const { error: delErr } = await supabase.from("coaching_products").delete().eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true, warnings };
  });

export const toggleCoachingProductActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: existing, error: selErr } = await supabase
      .from("coaching_products").select("*").eq("id", data.id).maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!existing) throw new Error("Product not found");

    if (existing.stripe_payment_link_id) {
      try {
        await stripeFetch(`/payment_links/${existing.stripe_payment_link_id}`, {
          method: "POST",
          body: formEncode({ active: data.active }),
        });
      } catch (e: any) {
        throw new Error(`Stripe: ${e.message}`);
      }
    }

    const { error } = await supabase
      .from("coaching_products")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Generate / refresh a shareable Stripe Payment Link for a product ─────
// Uses Stripe's /payment_links endpoint to produce a reusable URL that admin
// can copy and paste into texts, DMs, email, etc. Persists the URL + id back
// onto the coaching_products row.
export const generatePaymentLinkForProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: product, error } = await supabase
      .from("coaching_products")
      .select("id, name, stripe_price_id, stripe_payment_link_id, payment_link_url, mode, payment_structure")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) throw new Error("Product not found");
    if (!product.stripe_price_id) {
      throw new Error("Add a Stripe Price ID to this product before generating a payment link.");
    }

    // Deactivate the old payment link (if any) so we always return one current URL.
    if (product.stripe_payment_link_id) {
      try {
        await stripeFetch(`/payment_links/${product.stripe_payment_link_id}`, {
          method: "POST",
          body: formEncode({ active: false }),
        });
      } catch {
        // best-effort; keep going
      }
    }

    const link = await stripeFetch("/payment_links", {
      method: "POST",
      body: formEncode({
        "line_items[0][price]": product.stripe_price_id,
        "line_items[0][quantity]": 1,
        allow_promotion_codes: true,
        "metadata[product_id]": product.id,
      }),
    });

    const { error: upErr } = await supabase
      .from("coaching_products")
      .update({
        stripe_payment_link_id: link.id,
        payment_link_url: link.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);

    return { url: link.url as string, id: link.id as string };
  });