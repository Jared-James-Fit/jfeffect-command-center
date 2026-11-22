import { createFileRoute } from "@tanstack/react-router";

/**
 * Documents, day 30 of Recently deleted: their files and rows go for good
 * (purgeDeletedDocuments, documents.server.ts). Called once a day by pg_cron
 * `documents-purge` while anything is due.
 */
export const Route = createFileRoute("/api/public/hooks/documents-purge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { purgeDeletedDocuments } = await import("@/lib/documents/documents.server");
        try {
          return Response.json(await purgeDeletedDocuments(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
