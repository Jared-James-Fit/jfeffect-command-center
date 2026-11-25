/**
 * Live now, for Analytics (/admin/insights): who's in the app this minute and on which area. The
 * tabs' reads are lib/bi/bi.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any).rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Admins only.");
}

/** Just the live count, for a light refresh every 30 seconds. */
export const getLiveNowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data } = await db
      .from("app_sessions")
      .select("id, audience, entry_feature, city, region, country, platform")
      .gt("last_seen_at", since)
      .neq("audience", "test")
      .limit(500);
    const rows = ((data ?? []) as any[]).filter((r) => r.audience !== "staff");
    const ids = rows.map((r) => r.id);
    const where = new Map<string, string>();
    if (ids.length) {
      const { data: views } = await db
        .from("app_page_views")
        .select("session_id, feature, at")
        .in("session_id", ids.slice(0, 200))
        .order("at", { ascending: false })
        .limit(1000);
      for (const v of (views ?? []) as any[]) if (!where.has(v.session_id)) where.set(v.session_id, v.feature);
    }
    const byFeature = new Map<string, number>();
    for (const r of rows) {
      const f = where.get(r.id) ?? r.entry_feature ?? "Other";
      byFeature.set(f, (byFeature.get(f) ?? 0) + 1);
    }
    return {
      at: new Date().toISOString(),
      total: rows.length,
      byAudience: rows.reduce<Record<string, number>>((m, r) => ((m[r.audience] = (m[r.audience] ?? 0) + 1), m), {}),
      byFeature: [...byFeature.entries()].map(([feature, n]) => ({ feature, n })).sort((a, b) => b.n - a.n),
    };
  });
