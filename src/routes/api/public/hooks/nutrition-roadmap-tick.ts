import { createFileRoute } from "@tanstack/react-router";

/**
 * Passive monitoring for nutrition roadmaps (pg_cron nutrition-roadmap-tick,
 * daily): every roadmap read against the day's data, its status and next
 * check-in kept, a reforecast proposed only when the journey changed, a due
 * check-in reminded once, the coach told only when needed
 * (nutrition-roadmap/evaluate.server.ts). `{ clientId }` reads one athlete.
 */
export const Route = createFileRoute("/api/public/hooks/nutrition-roadmap-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { evaluateRoadmap, runRoadmapTick } = await import("@/lib/nutrition-roadmap/evaluate.server");
        let body: { clientId?: string } = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        if (body.clientId && /^[0-9a-f-]{36}$/i.test(body.clientId)) {
          const e = await evaluateRoadmap(supabaseAdmin, body.clientId, { trigger: "tick" });
          return Response.json({ ok: true, status: e.read.progress.status, created: !!e.created, checkin: e.read.checkin });
        }
        const r = await runRoadmapTick(supabaseAdmin);
        return Response.json({ ok: true, ...r });
      },
    },
  },
});
