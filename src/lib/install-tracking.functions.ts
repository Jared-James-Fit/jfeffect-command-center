import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const recordInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ platform: z.string().max(32) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("app_members")
      .update({
        install_detected_at: new Date().toISOString(),
        install_platform: data.platform,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const recordInstallDismissed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("app_members")
      .update({ install_dismissed_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });