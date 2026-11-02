import { createFileRoute } from "@tanstack/react-router";

/**
 * Program Intelligence AI runs, written in the background: called by the
 * database the moment a run is queued (`program_intel_jobs_queue_run`, with
 * `{ jobId }`) and by pg_cron every 5 minutes (no id: the oldest waiting or
 * cut-off run). One run per call. See runIntelJob in
 * src/lib/program-intel/jobs.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/program-intel-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let jobId: string | null = null;
        try {
          const body = (await request.json()) as { jobId?: unknown };
          if (typeof body?.jobId === "string" && /^[0-9a-f-]{36}$/i.test(body.jobId)) jobId = body.jobId;
        } catch {
          // no body: take the next waiting run
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runIntelJob } = await import("@/lib/program-intel/jobs.server");
        try {
          return Response.json(await runIntelJob(supabaseAdmin as any, jobId));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
