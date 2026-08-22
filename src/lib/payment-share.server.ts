/**
 * payment-share.server.ts
 *
 * Server-only resolution of the canonical shareable Stripe URL for a purchase
 * record. Strictly read-only against Stripe: it retrieves objects, never
 * creates charges, invoices, customers, subscriptions or ledger rows.
 */
import { choosePaymentShareStrategy, sanitizeShareUrl } from "@/lib/payment-share-link";

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in project secrets.");
  return key;
}

/** GET-only Stripe call. Returns null on any non-OK response. */
async function stripeGet(path: string): Promise<any | null> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${stripeKey()}` },
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

export type ShareLinkResult = {
  kind: "payment_link" | "hosted_invoice" | "checkout_session" | "none";
  url: string | null;
  /** True when the caller must generate a fresh Checkout Session server-side. */
  needsFreshCheckout: boolean;
  label: string;
  reason?: string;
};

export async function resolveShareLinkForPurchase(
  supabase: any,
  userId: string,
  purchaseRecordId: string,
): Promise<ShareLinkResult> {
  const { data: purchase, error } = await supabase
    .from("purchase_records")
    .select(
      "id, client_id, offer_id, offer_name, payment_status, stripe_payment_link, stripe_checkout_session_id, stripe_subscription_id, stripe_price_id",
    )
    .eq("id", purchaseRecordId)
    .single();
  if (error || !purchase) throw new Error("Purchase record not found");

  // Access gate: admin/coach, or the client who owns this purchase.
  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: any) => r.role);
  let allowed = roles.includes("admin") || roles.includes("coach");
  if (!allowed) {
    const { data: own } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    allowed = !!own?.id && own.id === purchase.client_id;
  }
  if (!allowed) throw new Error("Forbidden");

  // Reusable Stripe Payment Link stored on the linked coaching product.
  let productPaymentLinkUrl: string | null = null;
  if (purchase.offer_id) {
    const { data: product } = await supabase
      .from("coaching_products")
      .select("payment_link_url")
      .eq("id", purchase.offer_id)
      .maybeSingle();
    productPaymentLinkUrl = product?.payment_link_url ?? null;
  }

  // Outstanding hosted invoice (subscriptions past due / open invoices).
  let hostedInvoiceUrl: string | null = null;
  if (purchase.stripe_subscription_id) {
    const invoices = await stripeGet(
      `/invoices?subscription=${encodeURIComponent(purchase.stripe_subscription_id)}&status=open&limit=1`,
    );
    hostedInvoiceUrl = invoices?.data?.[0]?.hosted_invoice_url ?? null;
  }

  // Verify any stored Checkout Session is still open before reusing it.
  let existingSession: { status?: string | null; url?: string | null; expires_at?: number | null } | null = null;
  if (purchase.stripe_checkout_session_id) {
    const session = await stripeGet(
      `/checkout/sessions/${encodeURIComponent(purchase.stripe_checkout_session_id)}`,
    );
    if (session) {
      existingSession = {
        status: session.status ?? null,
        url: session.url ?? null,
        expires_at: typeof session.expires_at === "number" ? session.expires_at : null,
      };
    }
  }

  const strategy = choosePaymentShareStrategy({
    paymentStatus: purchase.payment_status,
    productPaymentLinkUrl,
    hostedInvoiceUrl,
    storedUrl: purchase.stripe_payment_link,
    existingSession,
    // Assignments carry client-specific metadata (purchase_record_id) so the
    // webhook can match the exact row; a reusable link is only correct when the
    // product itself exposes one and no client-specific session is already live.
    requiresClientSpecificCheckout: false,
  });

  if (strategy.kind === "none") {
    return { kind: "none", url: null, needsFreshCheckout: false, label: purchase.offer_name, reason: strategy.reason };
  }
  if (strategy.kind === "checkout_session") {
    return {
      kind: "checkout_session",
      url: strategy.reuseUrl ? sanitizeShareUrl(strategy.reuseUrl) : null,
      needsFreshCheckout: !strategy.reuseUrl,
      label: purchase.offer_name,
    };
  }
  return { kind: strategy.kind, url: strategy.url, needsFreshCheckout: false, label: purchase.offer_name };
}
