import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Write it now" on the dashboard's birthday card. Working out someone's
 * numbers can take longer than a signed-in request is allowed, so it runs
 * here as the service role (like the hourly drafting), after checking the
 * caller is the admin or this client's own coach. Still only a draft: nothing posts until it's
 * approved in the review sheet.
 */
export const draftBirthdayNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context as any;
    // the admin, or this client's own coach (the service role below skips the function's own check)
    const { assertStaffReachesClient } = await import("@/lib/staff-client-access.server");
    await assertStaffReachesClient(supabase, userId, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any).rpc("community_birthday_draft_now", { _client_id: data.clientId });
    if (error) throw new Error(error.message);
    return (row ?? {}) as Record<string, any>;
  });
