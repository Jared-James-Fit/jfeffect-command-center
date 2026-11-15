import { createFileRoute } from "@tanstack/react-router";

/**
 * Missing program data, the coach's morning push: pg_cron
 * `program-gaps-tick` once a day. See runProgramGapsAlerts in
 * src/lib/program-gaps.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/program-gaps-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runProgramGapsAlerts } = await import("@/lib/program-gaps.server");
        try {
          return Response.json(await runProgramGapsAlerts(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
