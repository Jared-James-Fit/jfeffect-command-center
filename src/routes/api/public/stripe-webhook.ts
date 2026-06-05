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
            case "checkout.session.completed": {
              const purchase = await findPurchase(supabase, {
                stripe_checkout_session_id: obj.id,
                stripe_payment_link: obj.payment_link ? `https://buy.stripe.com/${obj.payment_link}` : null,
              });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: obj.payment_status === "paid" ? "Paid" : "Pending Payment",
                  paid_at: obj.payment_status === "paid" ? now : purchase.paid_at,
                  amount_paid: obj.amount_total ? obj.amount_total / 100 : purchase.amount_paid,
                  stripe_checkout_session_id: obj.id,
                  stripe_payment_intent_id: obj.payment_intent ?? null,
                  stripe_subscription_id: obj.subscription ?? null,
                  stripe_customer_id: obj.customer ?? null,
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }
            case "payment_intent.succeeded": {
              const purchase = await findPurchase(supabase, { stripe_payment_intent_id: obj.id });
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
            case "payment_intent.payment_failed": {
              const purchase = await findPurchase(supabase, { stripe_payment_intent_id: obj.id });
              if (purchase) {
                await supabase.from("purchase_records").update({
                  payment_status: "Failed",
                  last_payment_update_source: "stripe_webhook",
                  last_payment_update_at: now,
                }).eq("id", purchase.id);
              }
              break;
            }
            case "invoice.payment_succeeded": {
              const purchase = await findPurchase(supabase, {
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
            case "invoice.payment_failed": {
              const purchase = await findPurchase(supabase, {
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
            case "customer.subscription.deleted": {
              const purchase = await findPurchase(supabase, { stripe_subscription_id: obj.id });
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
            case "charge.refunded": {
              const purchase = await findPurchase(supabase, { stripe_payment_intent_id: obj.payment_intent });
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