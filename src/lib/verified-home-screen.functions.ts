import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const recordVerifiedHomeScreenLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin.from("clients") as any)
      .update({ home_screen_verified_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
