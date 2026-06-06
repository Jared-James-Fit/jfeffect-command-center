/**
 * stripe-checkout.functions.ts
 *
 * Server-side functions for:
 *   1. Creating Stripe Checkout Sessions (subscription or one-time payment)
 *   2. Creating Stripe Customer Portal sessions (for clients to self-manage billing)
 *
 * These use the same stripeFetch / requireSupabaseAuth patterns as the rest of the app.
 * No Stripe SDK is needed — we call the Stripe REST API directly via fetch.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STRIPE_API = "https://api.stripe.com/v1";

function getStripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in project secrets.");
  return key;
}

function formEncode(params: Record<string, string | number | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }
  return usp.toString();
}

async function stripeFetch(path: string, init: { method?: string; body?: string } = {}): Promise<any> {
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

// ─── Create Checkout Session ──────────────────────────────────────────────────

const CreateCheckoutInput = z.object({
  /** ID of the coaching_products row */
  productId: z.string().uuid(),
  /** Absolute origin URL so success/cancel URLs work in any environment */
  origin: z.string().url(),
});

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateCheckoutInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // 1. Fetch the coaching product
    const { data: product, error: pErr } = await supabase
      .from("coaching_products")
      .select("id, name, stripe_price_id, mode, price_cents, currency, payment_structure")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error("Product not found");
    if (!product.stripe_price_id) {
      throw new Error(
        `"${product.name}" has no Stripe Price ID. Open Admin → Stripe Payment Links, edit this product, and add a Stripe Price ID before clients can check out.`
      );
    }

    // 2. Look up the client record for this auth user
    const { data: client } = await supabase
      .from("clients")
      .select("id, full_name, email, stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    // 3. Determine or create Stripe Customer
    let stripeCustomerId: string | null = client?.stripe_customer_id ?? null;

    if (!stripeCustomerId && client?.email) {
      // Search for existing Stripe customer by email first
      const existing = await stripeFetch(
        `/customers/search?query=${encodeURIComponent(`email:"${client.email}"`)}`,
      );
      if (existing?.data?.[0]?.id) {
        stripeCustomerId = existing.data[0].id;
      } else {
        // Create a new Stripe customer
        const newCustomer = await stripeFetch("/customers", {
          method: "POST",
          body: formEncode({
            email: client.email,
            name: client.full_name ?? undefined,
            "metadata[client_id]": client.id,
            "metadata[user_id]": userId,
          }),
        });
        stripeCustomerId = newCustomer.id;
      }
      // Persist stripe_customer_id on the clients row
      if (stripeCustomerId && client?.id) {
        await supabase
          .from("clients")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", client.id);
      }
    }

    // 4. Determine checkout mode
    // coaching_products.mode is 'auto' (legacy) or 'payment' or 'subscription'
    // We also infer from payment_structure if mode is 'auto'
    const isSubscription =
      product.mode === "subscription" ||
      (product.mode === "auto" &&
        !!product.payment_structure &&
        /monthly|weekly|bi-weekly|quarterly|annual|recurring/i.test(product.payment_structure));
    const checkoutMode = isSubscription ? "subscription" : "payment";

    // 5. Build Checkout Session params
    const sessionParams: Record<string, string> = {
      "line_items[0][price]": product.stripe_price_id,
      "line_items[0][quantity]": "1",
      mode: checkoutMode,
      success_url: `${data.origin}/portal/purchases?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.origin}/portal/purchases`,
      allow_promotion_codes: "true",
    };

    if (stripeCustomerId) {
      sessionParams["customer"] = stripeCustomerId;
    } else if (client?.email) {
      sessionParams["customer_email"] = client.email;
    }

    // Embed metadata so the webhook can match back to the client
    sessionParams["metadata[client_id]"] = client?.id ?? "";
    sessionParams["metadata[user_id]"] = userId;
    sessionParams["metadata[product_id]"] = data.productId;

    // 6. Create the Checkout Session
    const session = await stripeFetch("/checkout/sessions", {
      method: "POST",
      body: formEncode(sessionParams),
    });

    return { url: session.url as string, sessionId: session.id as string };
  });

// ─── Create Customer Portal Session ──────────────────────────────────────────

const CreatePortalInput = z.object({
  /** Absolute origin URL for the return_url */
  origin: z.string().url(),
});

export const createCustomerPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreatePortalInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Look up the client's Stripe customer ID
    const { data: client } = await supabase
      .from("clients")
      .select("id, stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    // Also check purchase_records for a stripe_customer_id if not on clients row
    let stripeCustomerId: string | null = client?.stripe_customer_id ?? null;

    if (!stripeCustomerId && client?.id) {
      const { data: pr } = await supabase
        .from("purchase_records")
        .select("stripe_customer_id")
        .eq("client_id", client.id)
        .not("stripe_customer_id", "is", null)
        .order("purchased_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      stripeCustomerId = pr?.stripe_customer_id ?? null;
    }

    if (!stripeCustomerId) {
      throw new Error(
        "No Stripe billing account found. You need to complete a purchase first before managing billing."
      );
    }

    const portalSession = await stripeFetch("/billing_portal/sessions", {
      method: "POST",
      body: formEncode({
        customer: stripeCustomerId,
        return_url: `${data.origin}/portal/account`,
      }),
    });

    return { url: portalSession.url as string };
  });

// ─── Create Checkout Session for an Admin-Assigned Purchase ──────────────────

const CreateAssignmentCheckoutInput = z.object({
  purchaseRecordId: z.string().uuid(),
  origin: z.string().url(),
});

/**
 * Generates a client-specific Stripe Checkout Session tied to an existing
 * purchase_records row. Stamps metadata[purchase_record_id] so the webhook
 * can match the exact assignment without fuzzy lookups.
 *
 * Saves stripe_payment_link + stripe_checkout_session_id back onto the row.
 */
export const createCheckoutSessionForAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateAssignmentCheckoutInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    // Admin / coach gate
    const { data: roleRows } = await supabase
      .from("user_roles").select("role").eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: any) => r.role);
    if (!roles.includes("admin") && !roles.includes("coach")) {
      throw new Error("Only admins or coaches can generate assignment checkout links.");
    }

    // Load the purchase record
    const { data: purchase, error: pErr } = await supabase
      .from("purchase_records")
      .select(
        "id, client_id, offer_id, stripe_price_id, stripe_product_id, payment_structure, full_payable_amount, currency, offer_name",
      )
      .eq("id", data.purchaseRecordId)
      .single();
    if (pErr || !purchase) throw new Error("Purchase record not found");

    // Resolve price id + checkout mode (snapshot row may not include them)
    let priceId: string | null = purchase.stripe_price_id ?? null;
    let productMode: string | null = null;
    let paymentStructure: string | null = purchase.payment_structure ?? null;
    if (purchase.offer_id) {
      const { data: prod } = await supabase
        .from("coaching_products")
        .select("stripe_price_id, mode, payment_structure")
        .eq("id", purchase.offer_id)
        .maybeSingle();
      if (prod) {
        priceId = priceId || prod.stripe_price_id;
        productMode = prod.mode ?? null;
        paymentStructure = paymentStructure || prod.payment_structure;
      }
    }
    if (!priceId) {
      throw new Error(
        `"${purchase.offer_name}" has no Stripe Price ID. Open Admin → Stripe Payment Links, edit this product, and add a Stripe Price ID before generating a checkout link.`,
      );
    }

    // Load client
    const { data: client, error: cErr } = await supabase
      .from("clients")
      .select("id, full_name, email, stripe_customer_id")
      .eq("id", purchase.client_id)
      .single();
    if (cErr || !client) throw new Error("Client not found");

    // Resolve / create Stripe customer
    let stripeCustomerId: string | null = client.stripe_customer_id ?? null;
    if (!stripeCustomerId && client.email) {
      const existing = await stripeFetch(
        `/customers/search?query=${encodeURIComponent(`email:"${client.email}"`)}`,
      );
      if (existing?.data?.[0]?.id) {
        stripeCustomerId = existing.data[0].id;
      } else {
        const newCustomer = await stripeFetch("/customers", {
          method: "POST",
          body: formEncode({
            email: client.email,
            name: client.full_name ?? undefined,
            "metadata[client_id]": client.id,
          }),
        });
        stripeCustomerId = newCustomer.id;
      }
      if (stripeCustomerId) {
        await supabase
          .from("clients")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", client.id);
      }
    }

    const isSubscription =
      productMode === "subscription" ||
      ((productMode === "auto" || !productMode) &&
        !!paymentStructure &&
        /monthly|weekly|bi-weekly|quarterly|annual|recurring/i.test(paymentStructure));
    const checkoutMode = isSubscription ? "subscription" : "payment";

    const sessionParams: Record<string, string> = {
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      mode: checkoutMode,
      success_url: `${data.origin}/portal/purchases?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.origin}/portal/purchases`,
      allow_promotion_codes: "true",
      "metadata[purchase_record_id]": purchase.id,
      "metadata[client_id]": client.id,
      "metadata[offer_id]": purchase.offer_id ?? "",
      "metadata[assigned_by]": userId,
    };
    if (stripeCustomerId) {
      sessionParams["customer"] = stripeCustomerId;
    } else if (client.email) {
      sessionParams["customer_email"] = client.email;
    }

    const session = await stripeFetch("/checkout/sessions", {
      method: "POST",
      body: formEncode(sessionParams),
    });

    await supabase
      .from("purchase_records")
      .update({
        stripe_payment_link: session.url,
        stripe_checkout_session_id: session.id,
        stripe_price_id: priceId,
        payment_status: "Pending",
        last_payment_update_source: "admin_assignment",
        last_payment_update_at: new Date().toISOString(),
      })
      .eq("id", purchase.id);

    return { url: session.url as string, sessionId: session.id as string };
  });
