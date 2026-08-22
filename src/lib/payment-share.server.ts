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

/* ────────────────────────────────────────────────────────────────────────────
 * SHORT SHARE LINKS  (/pay/<token>)
 *
 * iMessage mangles giant checkout.stripe.com session URLs (fragment + percent
 * encoding), linkifying only a prefix. We therefore hand clients a short
 * JF Effect URL that 302-redirects to the exact canonical Stripe URL.
 * The token is random and carries no data; resolution is server-side only.
 * ──────────────────────────────────────────────────────────────────────────── */

import {
  buildShareUrl,
  generateShareToken,
  isValidShareToken,
  shouldWrapForSharing,
} from "@/lib/payment-share-token";

export type MintShareLinkResult = {
  kind: ShareLinkResult["kind"];
  /** URL to give to the client — short JF Effect link when wrapping applies. */
  shareUrl: string | null;
  /** Canonical Stripe URL (admin "Open" action). */
  canonicalUrl: string | null;
  needsFreshCheckout: boolean;
  label: string;
  reason?: string;
};

/**
 * Resolve the canonical Stripe URL for a purchase and, when appropriate, mint
 * (or reuse) a short JF Effect share URL pointing at it.
 * Read-only against Stripe — never creates a charge, invoice or ledger row.
 */
export async function mintShareLinkForPurchase(
  supabase: any,
  userId: string,
  purchaseRecordId: string,
  origin: string,
): Promise<MintShareLinkResult> {
  const resolved = await resolveShareLinkForPurchase(supabase, userId, purchaseRecordId);

  if (resolved.kind === "none" || resolved.needsFreshCheckout || !resolved.url) {
    return {
      kind: resolved.kind,
      shareUrl: null,
      canonicalUrl: resolved.url,
      needsFreshCheckout: resolved.needsFreshCheckout,
      label: resolved.label,
      reason: resolved.reason,
    };
  }

  if (!shouldWrapForSharing(resolved.kind, resolved.url)) {
    return {
      kind: resolved.kind,
      shareUrl: resolved.url,
      canonicalUrl: resolved.url,
      needsFreshCheckout: false,
      label: resolved.label,
    };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Reuse an existing live token for this purchase so repeat copies are stable.
  const { data: existing } = await supabaseAdmin
    .from("payment_share_links")
    .select("token")
    .eq("purchase_record_id", purchaseRecordId)
    .eq("revoked", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    token = generateShareToken();
    const { error: insErr } = await supabaseAdmin.from("payment_share_links").insert({
      token,
      purchase_record_id: purchaseRecordId,
      created_by: userId,
    });
    if (insErr) throw new Error("Could not create a share link. Try again.");
  }

  return {
    kind: resolved.kind,
    shareUrl: buildShareUrl(origin, token),
    canonicalUrl: resolved.url,
    needsFreshCheckout: false,
    label: resolved.label,
  };
}

export type ResolvedTokenDestination =
  | { ok: true; url: string }
  | { ok: false; status: 404 | 410; message: string };

/**
 * Public resolution of a short token. Uses the service-role client because the
 * visitor is anonymous, but exposes NOTHING except the redirect destination.
 * Strictly read-only: retrieving a share link never creates a payment,
 * subscription, invoice or ledger row.
 */
export async function resolveShareToken(token: string): Promise<ResolvedTokenDestination> {
  if (!isValidShareToken(token)) {
    return { ok: false, status: 404, message: "This payment link is not valid." };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: link } = await supabaseAdmin
    .from("payment_share_links")
    .select("id, purchase_record_id, revoked")
    .eq("token", token)
    .maybeSingle();
  if (!link || link.revoked) {
    return { ok: false, status: 404, message: "This payment link is not valid." };
  }

  const { data: purchase } = await supabaseAdmin
    .from("purchase_records")
    .select("id, payment_status, stripe_payment_link, stripe_checkout_session_id, stripe_subscription_id, offer_id")
    .eq("id", link.purchase_record_id)
    .maybeSingle();
  if (!purchase) return { ok: false, status: 404, message: "This payment link is not valid." };

  const status = (purchase.payment_status ?? "").trim().toLowerCase();
  if (["paid", "active subscription", "refunded", "cancelled", "canceled"].includes(status)) {
    return { ok: false, status: 410, message: "This purchase is already settled — no payment is needed." };
  }

  // Prefer a still-open Checkout Session, then an open hosted invoice, then a
  // reusable Payment Link. Stripe calls here are GET-only.
  if (purchase.stripe_checkout_session_id) {
    const session = await stripeGet(
      `/checkout/sessions/${encodeURIComponent(purchase.stripe_checkout_session_id)}`,
    );
    const usable =
      session &&
      (session.status ?? "open") === "open" &&
      (typeof session.expires_at !== "number" || session.expires_at * 1000 - Date.now() > 5 * 60_000);
    const url = usable ? sanitizeShareUrl(session.url ?? null) : null;
    if (url) {
      await supabaseAdmin
        .from("payment_share_links")
        .update({ last_resolved_at: new Date().toISOString(), resolve_count: (undefined as any) ?? undefined })
        .eq("id", link.id);
      return { ok: true, url };
    }
  }

  if (purchase.stripe_subscription_id) {
    const invoices = await stripeGet(
      `/invoices?subscription=${encodeURIComponent(purchase.stripe_subscription_id)}&status=open&limit=1`,
    );
    const url = sanitizeShareUrl(invoices?.data?.[0]?.hosted_invoice_url ?? null);
    if (url) return { ok: true, url };
  }

  const stored = sanitizeShareUrl(purchase.stripe_payment_link ?? null);
  if (stored && /^https:\/\/([a-z0-9-]+\.)?buy\.stripe\.com\//i.test(stored)) {
    return { ok: true, url: stored };
  }

  return {
    ok: false,
    status: 410,
    message: "This payment link has expired. Ask your coach to send you a fresh one.",
  };
}
