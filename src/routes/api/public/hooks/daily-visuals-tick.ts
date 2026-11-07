import { createFileRoute } from "@tanstack/react-router";

/**
 * Athlete Insights (series daily_visual; pg_cron job community-daily-visuals, or the coach, wakes it
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
        const { runDailyVisualTest, runDailyVisualsTick } = await import("@/lib/daily-visuals.server");
        // { test: { theme, style? } } makes a test post for the coach's card, never a day or a post
        const body = (await request.json().catch(() => null)) as { test?: any } | null;
        try {
          if (body?.test?.theme) return Response.json(await runDailyVisualTest(supabaseAdmin as any, body.test));
          return Response.json(await runDailyVisualsTick(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
