import { createFileRoute } from "@tanstack/react-router";

/**
 * Crew's lesson and tip decks, written in the background (post-decks.server.ts):
 * called by the database when there's work (`community_post_decks_kick`, with
 * `{ jobId }` or nothing for the next due) and by pg_cron. One deck per call;
 * when it's done it wakes the next run itself.
 */
export const Route = createFileRoute("/api/public/hooks/post-decks-tick")({
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
          // no body: the next job that's due
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runDeckJob } = await import("@/lib/post-decks.server");
        try {
          const out = await runDeckJob(supabaseAdmin as any, jobId);
          // the next one, while there are any (the database keeps how many run at once in check)
          if (out.status !== "idle") await (supabaseAdmin as any).rpc("community_post_decks_kick").then(() => undefined, () => undefined);
          return Response.json({ status: out.status, job: "job" in out ? out.job : null, detail: "detail" in out ? out.detail : null, cover: "deck" in out && out.deck ? out.deck.slides[0] : null });
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
