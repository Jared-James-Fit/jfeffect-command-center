/**
 * Discount / Promotion / Ambassador / Referral code server functions.
 *
 * - Admin CRUD + status transitions (uses requireSupabaseAuth; RLS enforces admin role).
 * - Server-side validation for checkout via the validate_discount_codes RPC.
 * - Audit logging written from server fns (service-role bypasses RLS).
 *
 * No live Stripe writes from these functions — Stripe sync is deferred to a
 * dedicated testing phase. See .lovable/plan.md.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeFetch, getStripeKeyForMode, formEncode, type StripeMode } from "@/lib/stripe.server";

export type DiscountCode = {
  id: string;
  internal_name: string;
  public_code: string;
  category: "promotion" | "ambassador" | "client_referral" | "retention" | "manual";
  description: string | null;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  subscription_duration: "once" | "forever" | "repeating";
  duration_months: number | null;
  eligible_product_ids: string[];
  applies_to_all_products: boolean;
  new_customers_only: boolean;
  existing_customers_only: boolean;
  min_purchase_cents: number | null;
  start_at: string | null;
  expires_at: string | null;
  time_zone: string;
  status: "draft" | "scheduled" | "active" | "paused" | "expired";
  total_usage_limit: number | null;
  per_customer_limit: number | null;
  pairing_allowed: boolean;
  pairable_category: string | null;
  max_promo_codes: number;
  max_referral_codes: number;
  max_total_codes: number;
  excluded_code_ids: string[];
  linked_ambassador_id: string | null;
  linked_client_id: string | null;
  stripe_coupon_id: string | null;
  stripe_promotion_code_id: string | null;
  stripe_test_mode_synced: boolean;
  stripe_live_mode_synced: boolean;
  stripe_test_coupon_id: string | null;
  stripe_test_promotion_code_id: string | null;
  stripe_live_coupon_id: string | null;
  stripe_live_promotion_code_id: string | null;
  stripe_last_sync_at: string | null;
  stripe_last_sync_error: string | null;
  stripe_active: boolean;
  created_at: string;
  updated_at: string;
};

const CategoryEnum = z.enum(["promotion", "ambassador", "client_referral", "retention", "manual"]);
const StatusEnum = z.enum(["draft", "scheduled", "active", "paused", "expired"]);
const TypeEnum = z.enum(["percentage", "fixed"]);
const DurationEnum = z.enum(["once", "forever", "repeating"]);

const ListInput = z.object({
  search: z.string().optional().default(""),
  category: z.union([CategoryEnum, z.literal("all")]).optional().default("all"),
  status: z.union([StatusEnum, z.literal("all"), z.literal("expiring_soon")]).optional().default("all"),
  page: z.number().int().min(1).optional().default(1),
  size: z.number().int().min(5).max(100).optional().default(25),
});

export const listDiscountCodesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q: any = (supabase as any).from("discount_codes").select("*", { count: "exact" });
    if (data.category !== "all") q = q.eq("category", data.category);
    if (data.status === "expiring_soon") {
      const in7 = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      q = q.eq("status", "active").not("expires_at", "is", null).lte("expires_at", in7);
    } else if (data.status !== "all") {
      q = q.eq("status", data.status);
    }
    if (data.search.trim()) {
      const s = `%${data.search.trim()}%`;
      q = q.or(`public_code.ilike.${s},internal_name.ilike.${s},description.ilike.${s}`);
    }
    q = q.order("created_at", { ascending: false }).range((data.page - 1) * data.size, data.page * data.size - 1);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as DiscountCode[], total: count ?? 0 };
  });

const UpsertInput = z.object({
  id: z.string().uuid().optional().nullable(),
  internal_name: z.string().min(1).max(120),
  public_code: z.string().min(2).max(60).regex(/^[A-Za-z0-9_-]+$/, "Code must be alphanumeric, dash, or underscore"),
  category: CategoryEnum,
  description: z.string().max(500).optional().nullable(),
  discount_type: TypeEnum,
  discount_value: z.number().min(0).max(100000),
  subscription_duration: DurationEnum,
  duration_months: z.number().int().positive().nullable().optional(),
  eligible_product_ids: z.array(z.string().uuid()).default([]),
  applies_to_all_products: z.boolean().default(false),
  new_customers_only: z.boolean().default(false),
  existing_customers_only: z.boolean().default(false),
  min_purchase_cents: z.number().int().min(0).nullable().optional(),
  start_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  time_zone: z.string().default("America/Winnipeg"),
  status: StatusEnum.default("draft"),
  total_usage_limit: z.number().int().positive().nullable().optional(),
  per_customer_limit: z.number().int().positive().nullable().optional(),
  pairing_allowed: z.boolean().default(false),
  pairable_category: CategoryEnum.nullable().optional(),
  max_promo_codes: z.number().int().min(0).max(5).default(1),
  max_referral_codes: z.number().int().min(0).max(5).default(1),
  max_total_codes: z.number().int().min(1).max(5).default(2),
  linked_ambassador_id: z.string().uuid().nullable().optional(),
  linked_client_id: z.string().uuid().nullable().optional(),
});

async function writeAudit(supabase: any, actorId: string, action: string, codeId: string | null, codePublic: string | null, metadata: any) {
  try {
    await supabase.from("discount_code_audit_log").insert({
      actor_id: actorId, action, code_id: codeId, code_public: codePublic, metadata,
    });
  } catch (e) {
    console.warn("[discount-codes] audit insert failed", (e as any)?.message ?? e);
  }
}

export const upsertDiscountCodeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpsertInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isUpdate = !!data.id;
    const payload: any = { ...data, updated_by: userId };
    delete payload.id;
    if (!isUpdate) payload.created_by = userId;

    let row: any;
    if (isUpdate) {
      const { data: r, error } = await (supabase as any)
        .from("discount_codes").update(payload).eq("id", data.id!).select().single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await (supabase as any)
        .from("discount_codes").insert(payload).select().single();
      if (error) throw new Error(error.message);
      row = r;
    }
    await writeAudit(supabase, userId, isUpdate ? "code_edited" : "code_created", row.id, row.public_code, { category: row.category, status: row.status });
    return { code: row as DiscountCode };
  });

const StatusInput = z.object({
  id: z.string().uuid(),
  status: StatusEnum,
});

export const setDiscountCodeStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await (supabase as any)
      .from("discount_codes").update({ status: data.status, updated_by: userId }).eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    const action =
      data.status === "active" ? "code_activated"
      : data.status === "paused" ? "code_paused"
      : data.status === "expired" ? "code_expired"
      : "code_edited";
    await writeAudit(supabase, userId, action, row.id, row.public_code, { status: data.status });
    return { code: row as DiscountCode };
  });

const ValidateInput = z.object({
  codes: z.array(z.string().min(1).max(60)).max(5),
  product_id: z.string().uuid().nullable().optional(),
});

export const validateDiscountCodesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ValidateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Dual-billing safeguard: discount codes apply only to JF Effect Stripe
    // purchases. A legacy Trainerize client must never redeem a code that
    // could trigger a new charge or override their existing external billing.
    const { data: legacy } = await (supabase as any)
      .from("clients")
      .select("billing_source")
      .eq("auth_user_id", userId)
      .eq("billing_source", "trainerize_legacy")
      .maybeSingle();
    if (legacy) {
      return {
        ok: false,
        applied: [],
        rejected: (data.codes ?? []).map((code: string) => ({
          code,
          reason: "Discount codes only apply to JF Effect Stripe billing. Your current plan is billed through the legacy Trainerize account and is unaffected.",
        })),
      };
    }
    const { data: result, error } = await (supabase as any).rpc("validate_discount_codes", {
      _codes: data.codes,
      _customer_id: userId,
      _product_id: data.product_id ?? null,
    });
    if (error) throw new Error(error.message);
    return result as {
      ok: boolean;
      applied: Array<{ id: string; code: string; category: string; discount_type: string; discount_value: number; subscription_duration: string; duration_months: number | null; description: string | null }>;
      rejected: Array<{ code: string | null; reason: string }>;
    };
  });

export const listDiscountRedemptionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    page: z.number().int().min(1).optional().default(1),
    size: z.number().int().min(5).max(100).optional().default(25),
    mode: z.enum(["all", "test", "live"]).optional().default("all"),
  }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    let q: any = (context.supabase as any).from("discount_code_redemptions")
      .select("*", { count: "exact" })
      .order("redeemed_at", { ascending: false })
      .range((data.page - 1) * data.size, data.page * data.size - 1);
    if (data.mode !== "all") q = q.eq("mode", data.mode);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

/* -------------------------------------------------------------------------- */
/* Public validator (unauthenticated)                                         */
/* -------------------------------------------------------------------------- */
/**
 * Public code validation used by the /membership signup form BEFORE the user
 * has an account. Calls the same SECURITY DEFINER RPC as the admin validator,
 * but via service_role so anon callers don't need EXECUTE on the RPC.
 *
 * Only returns metadata about the codes (no PII). Pairing limits + active
 * window + product eligibility are enforced inside the RPC.
 */
export const validatePublicDiscountCodesFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    codes: z.array(z.string().trim().min(1).max(60)).max(5),
  }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("validate_discount_codes", {
      _codes: data.codes,
      _customer_id: null,
      _product_id: null,
    });
    if (error) throw new Error(error.message);
    return result as {
      ok: boolean;
      applied: Array<{ id: string; code: string; category: string; discount_type: string; discount_value: number; subscription_duration: string; duration_months: number | null; description: string | null }>;
      rejected: Array<{ code: string | null; reason: string }>;
    };
  });

/* -------------------------------------------------------------------------- */
/* Stripe synchronization                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Build the Stripe coupon param body for a discount_codes row.
 * Notes:
 *   - Stripe coupon IDs are immutable once created. We derive a stable per-mode
 *     coupon id from the row UUID so re-sync is idempotent.
 *   - applies_to[products][] requires Stripe product IDs. We resolve our DB
 *     UUIDs against coaching_products.stripe_product_id when applicable.
 */
function buildCouponParams(row: any, couponId: string): Record<string, any> {
  const params: Record<string, any> = {
    id: couponId,
    name: row.internal_name,
    duration: row.subscription_duration,
  };
  if (row.discount_type === "percentage") {
    params.percent_off = row.discount_value;
  } else {
    // Stripe expects integer cents; treat discount_value as dollars for fixed.
    params.amount_off = Math.round(Number(row.discount_value) * 100);
    params.currency = "usd";
  }
  if (row.subscription_duration === "repeating" && row.duration_months) {
    params.duration_in_months = row.duration_months;
  }
  if (row.total_usage_limit) params.max_redemptions = row.total_usage_limit;
  if (row.expires_at) params.redeem_by = Math.floor(new Date(row.expires_at).getTime() / 1000);
  params.metadata = {
    discount_code_id: row.id,
    public_code: row.public_code,
    category: row.category,
  };
  return params;
}

function buildPromotionCodeParams(row: any, couponId: string): Record<string, any> {
  const params: Record<string, any> = {
    coupon: couponId,
    code: row.public_code,
    active: row.status === "active",
  };
  if (row.expires_at) params.expires_at = Math.floor(new Date(row.expires_at).getTime() / 1000);
  if (row.total_usage_limit) params.max_redemptions = row.total_usage_limit;
  const restrictions: Record<string, any> = {};
  if (row.new_customers_only) restrictions.first_time_transaction = true;
  if (row.min_purchase_cents && row.min_purchase_cents > 0) {
    restrictions.minimum_amount = row.min_purchase_cents;
    restrictions.minimum_amount_currency = "usd";
  }
  if (Object.keys(restrictions).length) params.restrictions = restrictions;
  params.metadata = {
    discount_code_id: row.id,
    public_code: row.public_code,
    category: row.category,
  };
  return params;
}

/** Create or fetch the Stripe coupon for this mode (idempotent on couponId). */
async function ensureStripeCoupon(apiKey: string, row: any, couponId: string): Promise<string> {
  // Try to fetch first — if it exists with our id, reuse it.
  try {
    const existing = await stripeFetch(`/coupons/${encodeURIComponent(couponId)}`, { apiKey });
    if (existing?.id) return existing.id;
  } catch {
    // not found → create
  }
  const params = buildCouponParams(row, couponId);
  const created = await stripeFetch(`/coupons`, {
    method: "POST",
    apiKey,
    body: formEncode(params),
    idempotencyKey: `coupon:${couponId}`,
  });
  return created.id;
}

/** Create or update the Stripe promotion code. Stripe enforces unique 'code' values per account. */
async function ensureStripePromotionCode(
  apiKey: string,
  row: any,
  couponId: string,
  existingId: string | null,
): Promise<string> {
  // If we already have an id, PATCH a small subset (active flag, expires_at, metadata).
  if (existingId) {
    const patch: Record<string, any> = {
      active: row.status === "active",
      metadata: { discount_code_id: row.id, public_code: row.public_code, category: row.category },
    };
    try {
      const updated = await stripeFetch(`/promotion_codes/${encodeURIComponent(existingId)}`, {
        method: "POST",
        apiKey,
        body: formEncode(patch),
      });
      return updated.id;
    } catch (e: any) {
      // Fall through to lookup by code below if the id no longer exists.
      if (!/no such promotion_code/i.test(e?.message ?? "")) throw e;
    }
  }
  // Look up by code first — Stripe rejects duplicate codes per coupon, so we reuse.
  const search = await stripeFetch(
    `/promotion_codes?code=${encodeURIComponent(row.public_code)}&coupon=${encodeURIComponent(couponId)}&limit=1`,
    { apiKey },
  );
  if (Array.isArray(search?.data) && search.data[0]?.id) return search.data[0].id;
  // Create fresh.
  const params = buildPromotionCodeParams(row, couponId);
  const created = await stripeFetch(`/promotion_codes`, {
    method: "POST",
    apiKey,
    body: formEncode(params),
    idempotencyKey: `promo:${row.id}:${couponId}`,
  });
  return created.id;
}

async function syncOneMode(row: any, mode: StripeMode): Promise<{ couponId: string; promoId: string } | null> {
  const apiKey = getStripeKeyForMode(mode);
  if (!apiKey) return null;
  // Derive a stable per-mode coupon id from the row UUID.
  const couponId = `${mode === "test" ? "tst" : "lv"}_${row.id.replace(/-/g, "").slice(0, 24)}`;
  const ensuredCoupon = await ensureStripeCoupon(apiKey, row, couponId);
  const existingPromoId = mode === "test"
    ? (row.stripe_test_promotion_code_id ?? null)
    : (row.stripe_live_promotion_code_id ?? null);
  const promoId = await ensureStripePromotionCode(apiKey, row, ensuredCoupon, existingPromoId);
  return { couponId: ensuredCoupon, promoId };
}

export const syncDiscountCodeToStripeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    id: z.string().uuid(),
    modes: z.array(z.enum(["test", "live"])).min(1).default(["test", "live"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // RLS scopes the SELECT to admins; non-admins get no row.
    const { data: row, error } = await (supabase as any)
      .from("discount_codes").select("*").eq("id", data.id).single();
    if (error || !row) throw new Error("Discount code not found or not permitted");

    const update: Record<string, any> = {
      stripe_last_sync_at: new Date().toISOString(),
      stripe_last_sync_error: null,
    };
    const results: Array<{ mode: StripeMode; ok: boolean; error?: string; couponId?: string; promoId?: string }> = [];

    for (const mode of data.modes) {
      try {
        const out = await syncOneMode(row, mode);
        if (!out) {
          results.push({ mode, ok: false, error: `No ${mode}-mode Stripe key configured` });
          continue;
        }
        if (mode === "test") {
          update.stripe_test_coupon_id = out.couponId;
          update.stripe_test_promotion_code_id = out.promoId;
          update.stripe_test_mode_synced = true;
        } else {
          update.stripe_live_coupon_id = out.couponId;
          update.stripe_live_promotion_code_id = out.promoId;
          update.stripe_live_mode_synced = true;
        }
        results.push({ mode, ok: true, couponId: out.couponId, promoId: out.promoId });
      } catch (e: any) {
        results.push({ mode, ok: false, error: e?.message ?? String(e) });
      }
    }

    const errs = results.filter((r) => !r.ok);
    if (errs.length) update.stripe_last_sync_error = errs.map((r) => `[${r.mode}] ${r.error}`).join(" | ");
    update.stripe_active = !!update.stripe_live_promotion_code_id && row.status === "active";

    const { error: updErr } = await (supabase as any).from("discount_codes").update(update).eq("id", row.id);
    if (updErr) throw new Error(updErr.message);

    await writeAudit(supabase, userId, "code_synced_to_stripe", row.id, row.public_code, { results });
    return { ok: errs.length === 0, results, applied: update };
  });