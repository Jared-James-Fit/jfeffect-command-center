import { createFileRoute } from "@tanstack/react-router";

/**
 * The cover-headline pass (post-headlines.server.ts): pg_cron every 15
 * minutes while any deck is left to look at (`community_post_headlines_kick`),
 * and the admin's Post design refresh. A batch per call; wakes the next run
 * itself while there are more.
 */
export const Route = createFileRoute("/api/public/hooks/post-headlines-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runHeadlineBatch } = await import("@/lib/post-headlines.server");
        try {
          const out = await runHeadlineBatch(supabaseAdmin as any, 4);
          if (out.left && !out.done.some((d) => d.status === "failed" && d.problems?.some((p) => /credit|quota|paused|unavailable|401|429/i.test(p)))) {
            await (supabaseAdmin as any).rpc("community_post_headlines_kick").then(() => undefined, () => undefined);
          }
          return Response.json({ done: out.done, left: out.left });
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
