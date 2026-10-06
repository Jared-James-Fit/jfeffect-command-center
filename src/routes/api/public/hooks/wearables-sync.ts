import { createFileRoute } from "@tanstack/react-router";

// Scheduled worker (e.g. every 3 hours): pulls fresh data for every connected device.
// Auth: x-worker-secret header, same convention as the other /hooks workers.
export const Route = createFileRoute("/api/public/hooks/wearables-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return new Response("Unauthorized", { status: 401 });
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

function authorizeWorker(request: Request): boolean {
  const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
  if (!expected) return false;
  const provided = request.headers.get("x-worker-secret") ?? "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
