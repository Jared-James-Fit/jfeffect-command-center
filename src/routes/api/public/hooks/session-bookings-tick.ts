import { createFileRoute } from "@tanstack/react-router";

/**
 * "You're booked in" messages: called by the database the moment a session
 * is booked for a client (`pt_sessions_booked_kick`) and by pg_cron every
 * minute while one waits. See announceBookedSessions in
 * src/lib/session-booked.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/session-bookings-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { announceBookedSessions } = await import("@/lib/session-booked.server");
        try {
          return Response.json(await announceBookedSessions(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
