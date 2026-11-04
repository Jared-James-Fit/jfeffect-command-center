import { createFileRoute } from "@tanstack/react-router";

/**
 * Coaching leads' AI read and texts, written in the background: called by
 * the database the moment one is queued (`coaching_lead_replies_run`, with
 * `{ applicationId }`) and by pg_cron every 5 minutes (no id: the oldest
 * waiting or cut-off one). One lead per call. See runQueuedLead in
 * src/lib/coaching-leads.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/lead-replies-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        let applicationId: string | null = null;
        try {
          const body = (await request.json()) as { applicationId?: unknown };
          if (
            typeof body?.applicationId === "string" &&
            /^[0-9a-f-]{36}$/i.test(body.applicationId)
          ) {
            applicationId = body.applicationId;
          }
        } catch {
          // no body: take the next waiting lead
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runQueuedLead } = await import("@/lib/coaching-leads.server");
        try {
          return Response.json(await runQueuedLead(supabaseAdmin as any, applicationId));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
