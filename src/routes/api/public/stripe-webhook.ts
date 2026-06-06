import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Verify Stripe signature using Web Crypto (HMAC-SHA256).
// Header format: t=timestamp,v1=sig,v1=sig...
async function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => {
    const [k, ...v] = p.split("=");
    return [k, v.join("=")];
  }));
  const ts = parts.t;
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!ts || sigs.length === 0) return false;
  const signedPayload = `${ts}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > toleranceSec) return false;
  return sigs.some((s) => s === expected);
}

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function findPurchase(supabase: any, lookup: Record<string, string | null | undefined>) {
  for (const [col, val] of Object.entries(lookup)) {
    if (!val) continue;
    const { data } = await supabase.from("purchase_records").select("*").eq(col, val).maybeSingle();
    if (data) return data;
  }
  return null;
}

/**
 * Resolve the purchase record for a Stripe event.
 * Primary: metadata.purchase_record_id (set by createCheckoutSessionForAssignment).
 * Fallback: legacy lookups (session id, payment link, subscription, customer).
 */
async function resolvePurchase(
  supabase: any,
  obj: any,
  fallback: Record<string, string | null | undefined>,
) {
  const metaId: string | undefined =
    obj?.metadata?.purchase_record_id ||
    obj?.subscription_details?.metadata?.purchase_record_id;
  if (metaId) {
    const { data } = await supabase
      .from("purchase_records").select("*").eq("id", metaId).maybeSingle();
    if (data) return data;
  }
  return findPurchase(supabase, fallback);
}

/**
 * Sync stripe_customer_id onto the clients row so the Customer Portal
 * can be opened without scanning purchase_records every time.
 */
async function syncClientStripeCustomerId(supabase: any, stripeCustomerId: string | null, clientId: string | null) {
  if (!stripeCustomerId || !clientId) return;
  await supabase
    .from("clients")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", clientId)
    .is("stripe_customer_id", null); // only update if not already set
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("Webhook secret not configured", { status: 503 });

        const sig = request.headers.get("stripe-signature");
        const raw = await request.text();

        const ok = await verifyStripeSignature(raw, sig, secret);
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let event: any;
        try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const supabase = admin();
        const obj = event?.data?.object ?? {};
        const now = new Date().toISOString();

        try {
          switch (event.type) {

            // ── One-time & subscription checkout completion ─────────────────
            case "checkout.session.completed": {
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_checkout_session_id: obj.id,
                stripe_payment_link: obj.payment_link ? `https://buy.stripe.com/${obj.payment_link}` : null,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: obj.payment_status === "paid"
                    ? (obj.mode === "subscription" ? "Active Subscription" : "Paid")
                    : "Pending Payment",
                  paid_at: obj.payment_status === "paid" ? now : purchase.paid_at,
                  amount_paid: obj.amount_total ? obj.amount_total / 100 : purchase.amount_paid,
                  stripe_checkout_session_id: obj.id,
                  stripe_payment_intent_id: obj.payment_intent ?? null,
                  stripe_subscription_id: obj.subscription ?? null,
                  stripe_customer_id: obj.customer ?? null,
                  service_status: obj.payment_status === "paid" ? "Active" : purchase.service_status,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);

                // Sync stripe_customer_id to clients table for portal access
                await syncClientStripeCustomerId(supabase, obj.customer ?? null, purchase.client_id ?? null);
              }
              break;
            }

            // ── Subscription created (new subscriber) ───────────────────────
            case "customer.subscription.created": {
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.id,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: obj.status === "active" ? "Active Subscription"
                    : obj.status === "trialing" ? "Active Subscription"
                    : "Pending Payment",
                  stripe_subscription_id: obj.id,
                  stripe_customer_id: obj.customer ?? null,
                  service_status: obj.status === "active" || obj.status === "trialing" ? "Active" : purchase.service_status,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);

                await syncClientStripeCustomerId(supabase, obj.customer ?? null, purchase.client_id ?? null);
              }
              break;
            }

            // ── Subscription updated (renewal, cancellation, past_due) ──────
            case "customer.subscription.updated": {
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.id,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                // Map Stripe subscription status to app payment_status
                const statusMap: Record<string, string> = {
                  active: "Active Subscription",
                  trialing: "Active Subscription",
                  past_due: "Overdue",
                  unpaid: "Overdue",
                  canceled: "Cancelled",
                  incomplete: "Pending Payment",
                  incomplete_expired: "Failed",
                  paused: "Paused",
                };
                const newPaymentStatus = statusMap[obj.status] ?? purchase.payment_status;
                const newServiceStatus =
                  obj.status === "active" || obj.status === "trialing" ? "Active"
                  : obj.status === "canceled" ? "Cancelled"
                  : purchase.service_status;

                await supabase.from("purchase_records").update({
                  payment_status: newPaymentStatus,
                  service_status: newServiceStatus,
                  // Update term_end_date from current_period_end if available
                  ...(obj.current_period_end
                    ? { term_end_date: new Date(obj.current_period_end * 1000).toISOString().split("T")[0] }
                    : {}),
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);

                await syncClientStripeCustomerId(supabase, obj.customer ?? null, purchase.client_id ?? null);
              }
              break;
            }

            // ── Subscription deleted (hard cancel) ──────────────────────────
            case "customer.subscription.deleted": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_subscription_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Cancelled",
                  service_status: "Cancelled",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── Invoice paid (subscription renewal) ─────────────────────────
            case "invoice.payment_succeeded": {
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.subscription,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Active Subscription",
                  paid_at: now,
                  stripe_receipt_url: obj.hosted_invoice_url ?? purchase.stripe_receipt_url,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── Invoice failed (payment issue) ──────────────────────────────
            case "invoice.payment_failed": {
              const purchase = await resolvePurchase(supabase, obj, {
                stripe_subscription_id: obj.subscription,
                stripe_customer_id: obj.customer,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Overdue",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── One-time payment intent succeeded ───────────────────────────
            case "payment_intent.succeeded": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_payment_intent_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Paid",
                  paid_at: now,
                  amount_paid: obj.amount_received ? obj.amount_received / 100 : purchase.amount_paid,
                  stripe_receipt_url: obj.charges?.data?.[0]?.receipt_url ?? purchase.stripe_receipt_url,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── Payment intent failed ────────────────────────────────────────
            case "payment_intent.payment_failed": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_payment_intent_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Failed",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            // ── Refund ───────────────────────────────────────────────────────
            case "charge.refunded": {
              const purchase = await resolvePurchase(supabase, obj, { stripe_payment_intent_id: obj.payment_intent });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Refunded",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }

            default:
              break;
          }
        } catch (e: any) {
          console.error("[stripe-webhook] error", e?.message ?? e);
          return new Response("Internal error", { status: 500 });
        }

        return Response.json({ received: true });
      },
    },
  },
});
