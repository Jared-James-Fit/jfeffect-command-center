import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily pictures (pg_cron job community-daily-visuals, or the coach, wakes it
 * when a day is queued to be made): one step per run (the concept and
 * caption, or the picture and its review), learning from how the last ones
 * did, and it wakes the next run itself. See src/lib/daily-visuals.server.ts.
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
