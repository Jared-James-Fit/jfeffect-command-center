import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Admin required");
}

/**
 * Product → membership access mapping editor.
 *
 * Grants live on `product_access_grants` keyed by `offer_id`. Coaching products
 * link to an offer via `coaching_products.offer_id`. This module hides that
 * indirection so the admin UI works "per product".
 */

async function offerIdForProduct(supabaseAdmin: any, productId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("coaching_products").select("offer_id").eq("id", productId).maybeSingle();
  return (data?.offer_id as string | null) ?? null;
}

export const listAccessLevels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("access_levels").select("key,label,description,sort_order").order("sort_order");
    return { levels: data ?? [] };
  });

export const getProductGrant = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const offerId = await offerIdForProduct(supabaseAdmin, data.productId);
    if (!offerId) return { offerId: null, grant: null };
    const { data: grant } = await supabaseAdmin
      .from("product_access_grants").select("*").eq("offer_id", offerId).maybeSingle();
    return { offerId, grant };
  });

const UpsertInput = z.object({
  productId: z.string().uuid(),
  account_type_granted: z.enum(["coaching_client","app_member","program_only"]),
  access_level_keys: z.array(z.string().min(1).max(64)).max(10),
  included_plan_ids: z.array(z.string().uuid()).max(50).optional(),
  is_subscription: z.boolean().default(false),
});

export const upsertProductGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const offerId = await offerIdForProduct(supabaseAdmin, data.productId);
    if (!offerId) {
      throw new Error("This product isn't linked to an Offer yet. Open the product and set its Offer first, then add membership access.");
    }
    const { error } = await supabaseAdmin
      .from("product_access_grants").upsert({
        offer_id: offerId,
        account_type_granted: data.account_type_granted,
        access_level_keys: data.access_level_keys,
        included_plan_ids: data.included_plan_ids ?? [],
        is_subscription: data.is_subscription,
      }, { onConflict: "offer_id" });
    if (error) throw new Error(error.message);
    return { ok: true, offerId };
  });

export const deleteProductGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ productId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const offerId = await offerIdForProduct(supabaseAdmin, data.productId);
    if (!offerId) return { ok: true };
    const { error } = await supabaseAdmin
      .from("product_access_grants").delete().eq("offer_id", offerId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });