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
  priceCents: z.number().int().min(50).max(100_000_00),
  currency: z.string().trim().min(3).max(3).default("usd"),
  imagePath: z.string().trim().max(500).optional().nullable(),
});

export const createCoachingProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    // 1) Stripe product
    const product = await stripeFetch("/products", {
      method: "POST",
      body: formEncode({
        name: data.name,
        ...(data.description ? { description: data.description } : {}),
      }),
    });

    // 2) Stripe price
    const price = await stripeFetch("/prices", {
      method: "POST",
      body: formEncode({
        product: product.id,
        unit_amount: data.priceCents,
        currency: data.currency.toLowerCase(),
      }),
    });

    // 3) Stripe payment link
    const link = await stripeFetch("/payment_links", {
      method: "POST",
      body: formEncode({
        "line_items[0][price]": price.id,
        "line_items[0][quantity]": 1,
      }),
    });

    const { data: row, error } = await supabase
      .from("coaching_products")
      .insert({
        name: data.name,
        description: data.description ?? null,
        details: data.details ?? null,
        price_cents: data.priceCents,
        currency: data.currency.toLowerCase(),
        image_url: data.imagePath ?? null,
        stripe_product_id: product.id,
        stripe_price_id: price.id,
        stripe_payment_link_id: link.id,
        payment_link_url: link.url,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { product: row };
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