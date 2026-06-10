import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STRIPE_API = "https://api.stripe.com/v1";

const ALLOWED_ORIGIN_HOSTS = new Set<string>([
  "jfeffect.com",
  "www.jfeffect.com",
  "jfeffect-command-center.lovable.app",
]);
function assertAllowedOrigin(origin: string): string {
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("Invalid origin"); }
  const host = url.host.toLowerCase();
  const ok =
    ALLOWED_ORIGIN_HOSTS.has(host) ||
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovable.dev");
  if (!ok) throw new Error("Origin not allowed");
  return `${url.protocol}//${url.host}`;
}

function getStripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  return key;
}

function formEncode(params: Record<string, string | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.append(k, String(v));
  }
  return u.toString();
}

async function stripeFetch(path: string, init: { method?: string; body?: string } = {}) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${getStripeKey()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: init.body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error (${res.status})`);
  return json;
}

/* ---------- List member-facing offers ---------- */

export const listMemberOffers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase
      .from("coaching_products")
      .select("id,name,description,details,price_cents,currency,payment_structure,included_features,image_url,member_tier_label,stripe_price_id,active,archived,is_member_facing")
      .eq("is_member_facing", true)
      .eq("active", true)
      .eq("archived", false)
      .order("price_cents", { ascending: true });
    if (error) throw new Error(error.message);
    return { offers: data ?? [] };
  });

/* ---------- Checkout: member self-serve upgrade ---------- */

const Input = z.object({
  productId: z.string().uuid(),
  origin: z.string().url(),
});

export const createMemberCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: product, error: pErr } = await supabase
      .from("coaching_products")
      .select("id,name,stripe_price_id,mode,payment_structure,offer_id")
      .eq("id", data.productId).single();
    if (pErr || !product) throw new Error("Product not found");
    if (!product.stripe_price_id) throw new Error(`"${product.name}" has no Stripe Price ID.`);

    // Member row (may not exist yet — admin grants membership on first purchase via webhook)
    const { data: member } = await supabase
      .from("app_members").select("id,full_name,email,stripe_customer_id").eq("user_id", userId).maybeSingle();

    // Fallback to auth user email
    let email: string | null = member?.email ?? null;
    if (!email) {
      const { data: { user } } = await supabase.auth.getUser();
      email = user?.email ?? null;
    }

    // Find or create Stripe customer
    let stripeCustomerId: string | null = member?.stripe_customer_id ?? null;
    if (!stripeCustomerId && email) {
      const existing = await stripeFetch(`/customers/search?query=${encodeURIComponent(`email:"${email}"`)}`);
      if (existing?.data?.[0]?.id) {
        stripeCustomerId = existing.data[0].id;
      } else {
        const created = await stripeFetch("/customers", {
          method: "POST",
          body: formEncode({
            email,
            name: member?.full_name ?? undefined,
            "metadata[member_id]": member?.id ?? "",
            "metadata[user_id]": userId,
          }),
        });
        stripeCustomerId = created.id;
      }
      if (stripeCustomerId && member?.id) {
        await supabase.from("app_members").update({ stripe_customer_id: stripeCustomerId }).eq("id", member.id);
      }
    }

    const isSubscription =
      product.mode === "subscription" ||
      ((product.mode === "auto" || !product.mode) &&
        !!product.payment_structure &&
        /monthly|weekly|bi-weekly|quarterly|annual|recurring/i.test(product.payment_structure));
    const mode = isSubscription ? "subscription" : "payment";

    const params: Record<string,string> = {
      "line_items[0][price]": product.stripe_price_id,
      "line_items[0][quantity]": "1",
      mode,
      success_url: `${data.origin}/m?upgrade=success`,
      cancel_url: `${data.origin}/m/upgrade?cancelled=1`,
      allow_promotion_codes: "true",
      "metadata[member_id]": member?.id ?? "",
      "metadata[user_id]": userId,
      "metadata[product_id]": data.productId,
      "metadata[offer_id]": product.offer_id ?? "",
      "metadata[source]": "member_upgrade",
    };
    if (stripeCustomerId) params["customer"] = stripeCustomerId;
    else if (email) params["customer_email"] = email;

    const session = await stripeFetch("/checkout/sessions", { method: "POST", body: formEncode(params) });
    return { url: session.url as string, sessionId: session.id as string };
  });