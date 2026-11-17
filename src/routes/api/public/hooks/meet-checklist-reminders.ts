import { createFileRoute } from "@tanstack/react-router";

/**
 * Meet-day checklist reminders: pg_cron `meet-checklist-reminders` once a day.
 * See runMeetChecklistReminders in src/lib/meet-checklist-reminders.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/meet-checklist-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runMeetChecklistReminders } = await import("@/lib/meet-checklist-reminders.server");
        try {
          return Response.json(await runMeetChecklistReminders(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
