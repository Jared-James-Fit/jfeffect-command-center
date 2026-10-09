import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Write it now" on the dashboard's birthday card. Working out someone's
 * numbers can take longer than a signed-in request is allowed, so it runs
 * here as the service role (like the hourly drafting), after checking the
 * caller is a coach or admin. Still only a draft: nothing posts until it's
 * approved in the review sheet.
 */
export const draftBirthdayNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach")) throw new Error("Not allowed");
    const { data: row, error } = await (supabaseAdmin as any).rpc("community_birthday_draft_now", { _client_id: data.clientId });
    if (error) throw new Error(error.message);
    return (row ?? {}) as Record<string, any>;
  });
