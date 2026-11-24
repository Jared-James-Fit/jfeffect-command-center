import { createFileRoute } from "@tanstack/react-router";

/**
 * Competition Intelligence's worker (pg_cron competition-intel-tick every
 * minute while something's due, competition-intel-daily at 7:41 Winnipeg):
 * schedules worked out again, due milestones written, and the daily read
 * (competition/worker.server.ts). `{ milestoneId }` runs one milestone now
 * (the coach's Run now); `{ scan: "daily" }` the daily read.
 */
export const Route = createFileRoute("/api/public/hooks/competition-intel-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runCompetitionTick } = await import("@/lib/competition/worker.server");
        let body: { scan?: string; milestoneId?: string } = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const r = await runCompetitionTick(supabaseAdmin, {
          scan: body.scan === "daily" ? "daily" : null,
          milestoneId:
            body.milestoneId && /^[0-9a-f-]{36}$/i.test(body.milestoneId) ? body.milestoneId : null,
        });
        return Response.json({ ok: true, ...r });
      },
    },
  },
});
