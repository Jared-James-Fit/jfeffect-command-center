import { createFileRoute } from "@tanstack/react-router";

/**
 * Set videos' 720p copies for Crew, made on the server: called by the
 * database the moment a clip that needs one lands (`set_video_feed_jobs_kick`
 * with `{ setVideoId }`) and by pg_cron every minute while a job is due (no
 * id: the oldest due ones). See runFeedCopyJobs (set-videos/server-copy.server.ts).
 */
export const Route = createFileRoute("/api/public/hooks/feed-copies-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let setVideoId: string | null = null;
        try {
          const body = (await request.json()) as { setVideoId?: unknown };
          if (typeof body?.setVideoId === "string" && /^[0-9a-f-]{36}$/i.test(body.setVideoId)) setVideoId = body.setVideoId;
        } catch {
          // no body: the due ones
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { runFeedCopyJobs } = await import("@/lib/set-videos/server-copy.server");
          return Response.json(await runFeedCopyJobs(supabaseAdmin as any, setVideoId));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
