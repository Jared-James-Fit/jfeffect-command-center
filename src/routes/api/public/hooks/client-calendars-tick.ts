import { createFileRoute } from "@tanstack/react-router";

/**
 * Client Google Calendars (pg_cron job client-google-calendars-tick, every 5
 * minutes): keeps each connected client's "JF Effect" calendar in their own
 * Google account in step with the app. Does nothing until the Google sign-in
 * app is configured or anyone connects. See src/lib/client-gcal.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/client-calendars-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncDueClientCalendars } = await import("@/lib/client-gcal.server");
        try {
          return Response.json(await syncDueClientCalendars(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
