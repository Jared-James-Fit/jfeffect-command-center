import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { supabase, userId } = ctx;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Admin required");
}

export const listFeaturedPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("featured_member_items")
      .select("*, member_plans(id,name,status,cover_image_url,required_access_level,difficulty,weeks,days_per_week)")
      .eq("item_type", "plan")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const listFeaturedResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("featured_member_items")
      .select("*, member_resources(id,title,slug,status,kind,format,description,required_access_level,thumbnail_url)")
      .eq("item_type", "resource")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const addFeaturedResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ resourceId: z.string().uuid(), note: z.string().max(200).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: max } = await supabaseAdmin
      .from("featured_member_items").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const nextPos = ((max?.position as number | undefined) ?? -1) + 1;
    const { error } = await supabaseAdmin
      .from("featured_member_items")
      .upsert({
        item_type: "resource",
        resource_id: data.resourceId,
        position: nextPos,
        active: true,
        note: data.note ?? null,
      }, { onConflict: "resource_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addFeaturedPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      planId: z.string().uuid(),
      note: z.string().max(200).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: max } = await supabaseAdmin
      .from("featured_member_items")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((max?.position as number | undefined) ?? -1) + 1;
    const { error } = await supabaseAdmin
      .from("featured_member_items")
      .upsert(
        {
          item_type: "plan",
          plan_id: data.planId,
          position: nextPos,
          active: true,
          note: data.note ?? null,
        },
        { onConflict: "plan_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateFeaturedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      active: z.boolean().optional(),
      note: z.string().max(200).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...patch } = data;
    const { error } = await supabaseAdmin
      .from("featured_member_items")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeFeaturedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("featured_member_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderFeaturedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ orderedIds: z.array(z.string().uuid()).max(100) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await Promise.all(
      data.orderedIds.map((id, idx) =>
        supabaseAdmin
          .from("featured_member_items")
          .update({ position: idx })
          .eq("id", id),
      ),
    );
    return { ok: true };
  });