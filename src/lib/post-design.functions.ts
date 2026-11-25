import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The admin's Post design refresh (Crew → Posts → Manage → Post design):
 * wakes the cover-headline pass (post-headlines.server.ts) now instead of at
 * its next quarter hour, and says how far it's got. Staff only.
 */
export const refreshPostHeadlines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId);
    if (!(roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach")) throw new Error("Not allowed");
    const { data: woke } = await (supabaseAdmin as any).rpc("community_post_headlines_kick");
    const { data: rows } = await (supabaseAdmin as any).from("community_post_headlines").select("status");
    const counts: Record<string, number> = {};
    for (const r of (rows ?? []) as { status: string }[]) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { running: woke === true, counts };
  });
