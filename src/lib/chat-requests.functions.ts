import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertCoachOrAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("coach")) {
    throw new Error("Forbidden");
  }
  return roles;
}

/**
 * Grant a set of clients access to a recipe (used when sharing via chat).
 * - Inserts recipe_client_access rows (idempotent).
 * - If the recipe's access_scope is "hidden", switch it to "selected_clients"
 *   so the recipients can actually open it.
 */
export const shareRecipeWithClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      recipe_id: z.string().uuid(),
      client_ids: z.array(z.string().uuid()).min(1).max(200),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCoachOrAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ids = Array.from(new Set(data.client_ids));

    const { data: recipe, error: rErr } = await supabaseAdmin
      .from("recipes").select("id, access_scope").eq("id", data.recipe_id).maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!recipe) throw new Error("Recipe not found");

    const rows = ids.map((cid) => ({ recipe_id: data.recipe_id, client_id: cid }));
    const { error: insErr } = await supabaseAdmin
      .from("recipe_client_access")
      .upsert(rows, { onConflict: "recipe_id,client_id", ignoreDuplicates: true });
    if (insErr) throw new Error(insErr.message);

    if (recipe.access_scope === "hidden") {
      await supabaseAdmin
        .from("recipes")
        .update({ access_scope: "selected_clients" })
        .eq("id", data.recipe_id);
    }

    return { ok: true, client_ids: ids };
  });