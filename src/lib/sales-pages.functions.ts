import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PageKey = z.enum(["join", "coaching"]);

export type SalesPageRow = {
  page_key: "join" | "coaching";
  published: boolean;
  hero_headline: string;
  hero_subheadline: string;
  hero_image_url: string | null;
  primary_cta_label: string;
  primary_cta_kind: "checkout" | "application" | "booking" | "external" | "lead_form";
  primary_cta_url: string | null;
  secondary_cta_label: string | null;
  secondary_cta_href: string | null;
  sections: Record<string, any>;
  visuals: Array<{ url: string; alt?: string; slot?: string; visible?: boolean; order?: number }>;
  testimonials: Array<{ name: string; quote: string; image_url?: string; visible?: boolean; order?: number }>;
  promo_message: string | null;
  updated_at: string;
};

/** Public: read a single page. Returns null if missing or unpublished. */
export const getPublicSalesPage = createServerFn({ method: "GET" })
  .inputValidator((i: { page_key: "join" | "coaching" }) => z.object({ page_key: PageKey }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("sales_pages")
      .select("*")
      .eq("page_key", data.page_key)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as SalesPageRow | null;
  });

async function assertAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Admin required");
}

/** Admin: read full page (regardless of published). */
export const getSalesPageAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { page_key: "join" | "coaching" }) => z.object({ page_key: PageKey }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("sales_pages").select("*").eq("page_key", data.page_key).maybeSingle();
    if (error) throw new Error(error.message);
    return row as SalesPageRow;
  });

const patchSchema = z.object({
  page_key: PageKey,
  patch: z.object({
    published: z.boolean().optional(),
    hero_headline: z.string().optional(),
    hero_subheadline: z.string().optional(),
    hero_image_url: z.string().nullable().optional(),
    primary_cta_label: z.string().optional(),
    primary_cta_kind: z.enum(["checkout","application","booking","external","lead_form"]).optional(),
    primary_cta_url: z.string().nullable().optional(),
    secondary_cta_label: z.string().nullable().optional(),
    secondary_cta_href: z.string().nullable().optional(),
    sections: z.record(z.any()).optional(),
    visuals: z.array(z.any()).optional(),
    testimonials: z.array(z.any()).optional(),
    promo_message: z.string().nullable().optional(),
  }),
});

export const updateSalesPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof patchSchema>) => patchSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("sales_pages")
      .update({ ...data.patch, updated_by: context.userId })
      .eq("page_key", data.page_key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });