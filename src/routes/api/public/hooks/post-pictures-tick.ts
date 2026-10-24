import { createFileRoute } from "@tanstack/react-router";

/**
 * Post pictures (pg_cron job post-pictures-tick, every 3 hours): a real picture
 * for Saturday Spirit's next post, or for one that went out without one. See
 * src/lib/post-pictures.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/post-pictures-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runPostPicturesTick } = await import("@/lib/post-pictures.server");
        try {
          return Response.json(await runPostPicturesTick(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
