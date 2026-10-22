import { createFileRoute } from "@tanstack/react-router";

/**
 * Google Calendar → app sessions for one or more clients, run by the
 * database (x-hook-secret) for back-office imports; coaches use the Sessions
 * tab's "From Google Calendar". POST { from, to, clients: [{ id, terms? }],
 * apply?, eventIds? }: without apply it returns what would be imported (no
 * event details beyond title, day and time); with apply it imports them (or
 * only eventIds). See src/lib/gcal-session-import.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/gcal-session-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as any;
        const day = /^\d{4}-\d{2}-\d{2}$/;
        const clients = Array.isArray(body?.clients) ? body.clients.filter((c: any) => typeof c?.id === "string") : [];
        if (!body || !day.test(body.from) || !day.test(body.to) || clients.length === 0) {
          return Response.json({ error: "from, to (yyyy-mm-dd) and clients are required" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { previewGoogleImport, applyGoogleImport } = await import("@/lib/gcal-session-import.server");
        try {
          const terms = Object.fromEntries(clients.map((c: any) => [c.id, Array.isArray(c.terms) ? c.terms.map(String) : []]));
          const preview = await previewGoogleImport(supabaseAdmin as any, { clientIds: clients.map((c: any) => c.id), from: body.from, to: body.to, terms });
          if (!body.apply) return Response.json(preview);
          const only = Array.isArray(body.eventIds) ? new Set(body.eventIds.map(String)) : null;
          const chosen = preview.candidates.filter((c) => !only || only.has(c.eventId));
          return Response.json({ applied: chosen.length, ...(await applyGoogleImport(supabaseAdmin as any, chosen)) });
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
