import { createFileRoute } from "@tanstack/react-router";

/**
 * OpenIPF's push: woken by public.openipf_tick (pg_cron, every minute) when a
 * finished search found someone or the sync brought in a new meet. See
 * runOpenIpfNotify in src/lib/openipf.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/openipf-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runOpenIpfNotify } = await import("@/lib/openipf.server");
        try {
          return Response.json(await runOpenIpfNotify(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
