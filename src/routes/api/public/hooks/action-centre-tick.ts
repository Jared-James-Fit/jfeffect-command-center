import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron-triggered maintenance for the Action Centre.
 * Transitions occurrences upcoming → due_soon → due_today → overdue based on
 * the row's `due_at_utc` (already resolved from the client's local tz at
 * generation time), so this stays a simple UTC comparison.
 *
 * Gated by the shared x-worker-secret check used by every sibling worker hook.
 */
export const Route = createFileRoute("/api/public/hooks/action-centre-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeWorker(request)) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();
        const isoNow = now.toISOString();
        const in24h = new Date(now.getTime() + 24 * 3600_000).toISOString();
        const in72h = new Date(now.getTime() + 72 * 3600_000).toISOString();

        // overdue: past due, still active
        await supabaseAdmin
          .from("client_task_occurrences")
          .update({ status: "overdue" })
          .lt("due_at_utc", isoNow)
          .in("status", ["upcoming", "due_soon", "due_today"]);

        // due_today: due within the next 24h
        await supabaseAdmin
          .from("client_task_occurrences")
          .update({ status: "due_today" })
          .gte("due_at_utc", isoNow)
          .lt("due_at_utc", in24h)
          .in("status", ["upcoming", "due_soon"]);

        // due_soon: due within the next 72h
        await supabaseAdmin
          .from("client_task_occurrences")
          .update({ status: "due_soon" })
          .gte("due_at_utc", in24h)
          .lt("due_at_utc", in72h)
          .eq("status", "upcoming");

        return Response.json({ ok: true, at: isoNow });
      },
      GET: async () => Response.json({ ok: true, note: "POST to trigger" }),
    },
  },
});

function authorizeWorker(request: Request): boolean {
  const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
  if (!expected) return false;
  const provided =
    request.headers.get("x-worker-secret") ?? "";
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
