/**
 * The coach's read of a client's health profile (health-profile.ts): the same
 * read every nutrition AI path uses (`loadFoodContext`, which builds it with the
 * food history), for staff who can see the client through their own login.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function isStaff(supabase: any, userId: string) {
  const [{ data: a }, { data: c }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

export const getHealthProfileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const { data: visible } = await context.supabase.from("clients").select("id").eq("id", data.clientId).maybeSingle();
    if (!visible) throw new Error("Client not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadFoodContext } = await import("@/lib/nutrition-ai-plans.server");
    const food = await loadFoodContext(supabaseAdmin as any, data.clientId);
    return { health: food.health };
  });
