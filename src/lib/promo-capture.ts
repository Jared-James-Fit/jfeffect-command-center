// Stripe Checkout → promo_code_redemptions capture helpers.
// Shared by the live Stripe webhook (server route) and the admin backfill
// server function. No module-scope env reads — everything runs inside
// handler-invoked async functions.
import { stripeFetch } from "@/lib/stripe.server";

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _uuidOrNull = (v: any) => (typeof v === "string" && _UUID_RE.test(v) ? v : null);
const _idOf = (v: any): string | null =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && typeof v.id === "string"
      ? v.id
      : null;

/** Fetch a Checkout Session with all the discount-related expansions. */
export async function fetchExpandedCheckoutSession(sessionId: string): Promise<any> {
  return await stripeFetch(
    `/checkout/sessions/${encodeURIComponent(sessionId)}` +
      `?expand[]=total_details.breakdown.discounts` +
      `&expand[]=discounts.promotion_code` +
      `&expand[]=discounts.coupon` +
      `&expand[]=customer` +
      `&expand[]=subscription` +
      `&expand[]=payment_intent`,
  );
}

/**
 * Build the promo_code_redemptions row from a fully-expanded Checkout Session.
 * Falls back to direct REST fetches for the promotion code and coupon so we
 * always end up with the canonical fields regardless of which expansion path
 * Stripe returns them on.
 */
export async function buildPromoRowFromSession(
  full: any,
  eventId: string | null,
): Promise<Record<string, any> | null> {
  if (!full?.id) return null;

  const breakdown = full?.total_details?.breakdown?.discounts?.[0] ?? null;
  const breakdownDiscount = breakdown?.discount ?? null;
  const lineDiscount = Array.isArray(full?.discounts) ? full.discounts[0] : null;

  let promoCodeId: string | null =
    _idOf(breakdownDiscount?.promotion_code) ?? _idOf(lineDiscount?.promotion_code);
  let promoCodeText: string | null =
    (lineDiscount?.promotion_code && typeof lineDiscount.promotion_code === "object"
      ? (lineDiscount.promotion_code as any).code
      : null) ??
    (breakdownDiscount?.promotion_code && typeof breakdownDiscount.promotion_code === "object"
      ? (breakdownDiscount.promotion_code as any).code
      : null);

  const couponFromDiscount =
    _idOf(breakdownDiscount?.coupon) ??
    _idOf((breakdownDiscount as any)?.source?.coupon) ??
    _idOf(lineDiscount?.coupon);
  const promoObj =
    (lineDiscount?.promotion_code && typeof lineDiscount.promotion_code === "object"
      ? (lineDiscount.promotion_code as any)
      : null) ??
    (breakdownDiscount?.promotion_code && typeof breakdownDiscount.promotion_code === "object"
      ? (breakdownDiscount.promotion_code as any)
      : null);
  const couponFromPromo =
    _idOf(promoObj?.coupon) ?? _idOf(promoObj?.promotion?.coupon);
  let couponId: string | null = couponFromDiscount ?? couponFromPromo;

  if (promoCodeId && !promoCodeText) {
    try {
      const pc = await stripeFetch(`/promotion_codes/${encodeURIComponent(promoCodeId)}`);
      promoCodeText = pc?.code ?? null;
      if (!couponId) couponId = _idOf(pc?.coupon) ?? _idOf(pc?.promotion?.coupon);
    } catch (e) {
      console.warn("[promo-capture] promotion_code fetch failed", (e as any)?.message || e);
    }
  }

  let couponObj: any = null;
  if (couponId) {
    try {
      couponObj = await stripeFetch(`/coupons/${encodeURIComponent(couponId)}`);
    } catch (e) {
      console.warn("[promo-capture] coupon fetch failed", (e as any)?.message || e);
    }
  }

  const md = full?.metadata ?? {};
  const amountDiscount =
    breakdown?.amount ?? full?.total_details?.amount_discount ?? null;

  return {
    promotion_code: promoCodeText,
    stripe_promotion_code_id: promoCodeId,
    stripe_coupon_id: couponId,
    discount_percent_off: couponObj?.percent_off ?? null,
    discount_amount_off: couponObj?.amount_off ?? null,
    discount_currency: couponObj?.currency ?? null,
    discount_duration: couponObj?.duration ?? null,
    amount_discount_cents: amountDiscount,
    product_type:
      md.kind || md.source || (full?.mode === "subscription" ? "subscription" : "one_time"),
    product_id: _uuidOrNull(md.product_id),
    product_name: md.product_name || null,
    checkout_type: full?.mode ?? null,
    source: md.source || md.kind || null,
    customer_email: full?.customer_details?.email ?? full?.customer_email ?? null,
    stripe_customer_id: _idOf(full?.customer),
    stripe_subscription_id: _idOf(full?.subscription),
    stripe_payment_intent_id: _idOf(full?.payment_intent),
    stripe_checkout_session_id: full.id,
    client_id: _uuidOrNull(md.client_id),
    member_id: _uuidOrNull(md.member_id),
    user_id: _uuidOrNull(md.user_id),
    stripe_event_id: eventId,
    raw: {
      breakdown_discount: breakdownDiscount,
      line_discount: lineDiscount,
      coupon: couponObj,
      promotion_code: promoObj,
      total_details: full?.total_details ?? null,
      metadata: md,
    },
    redeemed_at: new Date().toISOString(),
  };
}

/**
 * Idempotent upsert into promo_code_redemptions, keyed on checkout session id.
 * The partial UNIQUE index on stripe_checkout_session_id guarantees we never
 * insert a duplicate; on retry we update the existing row's discount fields.
 */
export async function upsertPromoRedemption(
  supabase: any,
  row: Record<string, any>,
): Promise<{ status: "inserted" | "updated" | "skipped"; error?: string }> {
  if (!row.stripe_checkout_session_id) {
    const { error } = await supabase.from("promo_code_redemptions").insert(row);
    if (error) return { status: "skipped", error: error.message };
    return { status: "inserted" };
  }
  const { data: existing } = await supabase
    .from("promo_code_redemptions")
    .select("id")
    .eq("stripe_checkout_session_id", row.stripe_checkout_session_id)
    .maybeSingle();
  if (existing) {
    const { redeemed_at: _ignore, ...patch } = row;
    const { error } = await supabase
      .from("promo_code_redemptions")
      .update(patch)
      .eq("id", existing.id);
    if (error) return { status: "skipped", error: error.message };
    return { status: "updated" };
  }
  const { error } = await supabase.from("promo_code_redemptions").insert(row);
  if (error) return { status: "skipped", error: error.message };
  return { status: "inserted" };
}