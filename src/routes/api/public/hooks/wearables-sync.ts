import { createFileRoute } from "@tanstack/react-router";

// Scheduled worker (e.g. every 3 hours): pulls fresh data for every connected device.
// Auth: x-worker-secret header, same convention as the other /hooks workers.
export const Route = createFileRoute("/api/public/hooks/wearables-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeWorker(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin: typedAdmin } = await import("@/integrations/supabase/client.server");
        const supabaseAdmin = typedAdmin as any; // generated types predate the wearable tables
        const { syncConnection } = await import("@/lib/wearables/sync.server");
        const { data: conns } = await supabaseAdmin
          .from("wearable_connections")
          .select("id")
          .eq("status", "connected")
          .eq("provider", "oura")
          .order("last_synced_at", { ascending: true, nullsFirst: true })
          .limit(200);
        let ok = 0;
        let failed = 0;
        let skipped = 0;
        for (const c of conns ?? []) {
          const r = await syncConnection(c.id);
          if (r.skipped) skipped++;
          else if (r.ok) ok++;
          else failed++;
        }
        return Response.json({ ok: true, synced: ok, failed, skipped });
      },
    },
  },
});

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}
