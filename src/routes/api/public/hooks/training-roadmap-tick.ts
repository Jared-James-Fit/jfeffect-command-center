import { createFileRoute } from "@tanstack/react-router";

/**
 * Training roadmap (pg_cron job training-roadmap-tick, every 5 minutes): Cleo
 * rewrites the block purpose and weekly focus for programs that changed. See
 * src/lib/training-roadmap.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/training-roadmap-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runRoadmapTick } = await import("@/lib/training-roadmap.server");
        try {
          return Response.json(await runRoadmapTick(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
