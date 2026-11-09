import { createFileRoute } from "@tanstack/react-router";

/**
 * The background schedule sync: puts queued clients' upcoming, unstarted workouts on their
 * training days after their days, a block's dates or a program's weeks changed anywhere
 * (`pl_schedule_sync_queue`). Called by pg_cron every minute, only while something waits.
 * See runScheduleSyncQueue in src/lib/schedule-bulk.functions.ts.
 */
export const Route = createFileRoute("/api/public/hooks/schedule-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { runScheduleSyncQueue } = await import("@/lib/schedule-bulk.functions");
        try {
          return Response.json(await runScheduleSyncQueue());
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
