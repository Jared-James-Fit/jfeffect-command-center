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
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });