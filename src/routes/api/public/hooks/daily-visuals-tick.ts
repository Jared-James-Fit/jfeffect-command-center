import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily pictures (pg_cron job community-daily-visuals wakes it when a day is
 * missing its words or picture): one line and one picture per run, learning
 * from how the last ones did. See src/lib/daily-visuals.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/daily-visuals-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runDailyVisualsTick } = await import("@/lib/daily-visuals.server");
        try {
          return Response.json(await runDailyVisualsTick(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
