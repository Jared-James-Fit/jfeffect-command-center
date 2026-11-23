import { createFileRoute } from "@tanstack/react-router";

/**
 * The AI health tick: pg_cron `ai-health-tick` every 5 minutes (20270512090000_ai_reliability.sql).
 * Probes a provider that's down, raises and closes the AI alerts, counts stuck jobs, watches
 * spend, and redoes what failed once AI answers again. See runAiHealthTick in
 * src/lib/ai/ai-monitor.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/ai-health-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAiHealthTick } = await import("@/lib/ai/ai-monitor.server");
        try {
          return Response.json(await runAiHealthTick(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
