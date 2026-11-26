import { createFileRoute } from "@tanstack/react-router";

/**
 * Athlete Intelligence, in the background (src/lib/athlete-intel): one
 * uploaded source read per call. Called by the database the moment one is
 * queued (`athlete_intel_queue_run` with `{ sourceId }`) and by pg_cron while
 * something's due (athlete_intel_due: a source waiting, one cut off, one
 * waiting on AI whose retry is due, files to remove). See runIntelTick.
 */
export const Route = createFileRoute("/api/public/hooks/athlete-intel-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let sourceId: string | null = null;
        try {
          const body = (await request.json()) as { sourceId?: unknown };
          sourceId = typeof body?.sourceId === "string" && /^[0-9a-f-]{36}$/i.test(body.sourceId) ? body.sourceId : null;
        } catch {
          // no body: the next one due, else clean-up
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { runIntelTick } = await import("@/lib/athlete-intel/worker.server");
          const first = await runIntelTick(supabaseAdmin as any, sourceId);
          // anything else waiting gets a turn while there's time (a few at most)
          const more = [];
          if (!sourceId) {
            const t0 = Date.now();
            for (let i = 0; i < 3 && Date.now() - t0 < 60_000; i++) {
              const r = await runIntelTick(supabaseAdmin as any, null);
              more.push(r);
              if (r.status === "idle") break;
            }
          }
          return Response.json({ ...first, more });
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
