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