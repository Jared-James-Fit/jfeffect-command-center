import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const listPromoRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      search: z.string().optional(),
      code: z.string().optional(),
      productType: z.string().optional(),
      email: z.string().optional(),
      from: z.string().optional(), // ISO date
      to: z.string().optional(),   // ISO date
      limit: z.number().int().min(1).max(500).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    let q = supabase
      .from("promo_code_redemptions")
      .select("*")
      .order("redeemed_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.search && data.search.trim()) {
      const s = data.search.trim();
      q = q.or(
        `promotion_code.ilike.%${s}%,customer_email.ilike.%${s}%,stripe_customer_id.ilike.%${s}%,product_name.ilike.%${s}%`,
      );
    }
    if (data.code && data.code.trim()) q = q.ilike("promotion_code", `%${data.code.trim()}%`);
    if (data.productType && data.productType.trim()) q = q.eq("product_type", data.productType.trim());
    if (data.email && data.email.trim()) q = q.ilike("customer_email", `%${data.email.trim()}%`);
    if (data.from) q = q.gte("redeemed_at", data.from);
    if (data.to) q = q.lte("redeemed_at", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

/**
 * Admin-triggered backfill: re-pull a Checkout Session from Stripe and refresh
 * the matching promo_code_redemptions row with the latest discount metadata.
 * Returns the resolved row + diagnostics so the admin UI can show what Stripe
 * actually attached to the session (vs guessing).
 */
export const backfillPromoFromSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sessionId: z.string().min(5) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      fetchExpandedCheckoutSession,
      buildPromoRowFromSession,
      upsertPromoRedemption,
    } = await import("@/lib/promo-capture");
    let session: any;
    try {
      session = await fetchExpandedCheckoutSession(data.sessionId);
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Stripe fetch failed", session_id: data.sessionId };
    }
    const row = await buildPromoRowFromSession(session, null);
    if (!row) return { ok: false, error: "No row built from session", session_id: data.sessionId };
    const res = await upsertPromoRedemption(supabaseAdmin, row);
    return {
      ok: true,
      status: res.status,
      stripe_attached_discount: Boolean(row.stripe_promotion_code_id || row.stripe_coupon_id),
      row: {
        promotion_code: row.promotion_code,
        stripe_promotion_code_id: row.stripe_promotion_code_id,
        stripe_coupon_id: row.stripe_coupon_id,
        discount_percent_off: row.discount_percent_off,
        discount_amount_off: row.discount_amount_off,
        discount_currency: row.discount_currency,
        discount_duration: row.discount_duration,
        amount_discount_cents: row.amount_discount_cents,
        customer_email: row.customer_email,
        stripe_customer_id: row.stripe_customer_id,
        stripe_subscription_id: row.stripe_subscription_id,
        stripe_checkout_session_id: row.stripe_checkout_session_id,
      },
    };
  });