// ============================================================================
// Phase 6 — Pending Signup cleanup
//
// Deletes expired jf_pending_signups that have no completed checkout. Idempotent
// and safe to call hourly via pg_cron. Authenticates via the project's Supabase
// publishable apikey header. Never logs password_hash or any other signup secret.
// ============================================================================
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/cleanup-pending-signups")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const cutoff = new Date().toISOString();
        const { data: expired, error: selErr } = await supabaseAdmin
          .from("jf_pending_signups")
          .select("id, email, expires_at")
          .lt("expires_at", cutoff)
          .limit(500);
        if (selErr) {
          console.error("[cleanup-pending-signups] select failed", selErr.message);
          return Response.json({ ok: false, error: "select_failed" }, { status: 500 });
        }
        if (!expired || expired.length === 0) {
          return Response.json({ ok: true, removed: 0, checked: 0 });
        }

        const emails = expired.map((r: any) => (r.email ?? "").toLowerCase()).filter(Boolean);
        const { data: existingMembers } = await supabaseAdmin
          .from("app_members").select("email").in("email", emails);
        const finalized = new Set((existingMembers ?? []).map((m: any) => (m.email ?? "").toLowerCase()));

        const removeIds: string[] = [];
        let preserved = 0;
        for (const row of expired) {
          if (finalized.has((row.email ?? "").toLowerCase())) { preserved += 1; continue; }
          removeIds.push(row.id);
        }

        let removed = 0;
        if (removeIds.length > 0) {
          const { error: delErr, count } = await supabaseAdmin
            .from("jf_pending_signups")
            .delete({ count: "exact" })
            .in("id", removeIds);
          if (delErr) {
            console.error("[cleanup-pending-signups] delete failed", delErr.message);
            return Response.json({ ok: false, error: "delete_failed" }, { status: 500 });
          }
          removed = count ?? removeIds.length;
        }

        return Response.json({
          ok: true,
          checked: expired.length,
          removed,
          preserved_finalized: preserved,
          ran_at: new Date().toISOString(),
        });
      },
    },
  },
});

function authorizeWorker(request: Request): boolean {
  const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
  if (!expected) return false;
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-worker-secret") ?? url.searchParams.get("secret") ?? "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}