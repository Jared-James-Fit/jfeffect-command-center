import { createFileRoute } from "@tanstack/react-router";

/**
 * Goal intelligence's background work (pg_cron `goal-intel-tick`, every 5
 * minutes, only while goal_intel_due()): client goal updates whose review
 * window is up (sent only when the client is offline), goals read out of new
 * meeting analyses, check-ins and clients' messages (proposed for the coach),
 * and the 6-hourly read of every open goal (goal-intel/worker.server.ts).
 * Cron hook secret only.
 */
export const Route = createFileRoute("/api/public/hooks/goal-intel-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runGoalIntelTick } = await import("@/lib/goal-intel/worker.server");
        const report = await runGoalIntelTick(supabaseAdmin as any).catch((e: any) => ({ error: String(e?.message ?? e) }));
        return Response.json({ ok: true, report });
      },
    },
  },
});
