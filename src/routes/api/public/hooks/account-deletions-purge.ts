import { createFileRoute } from "@tanstack/react-router";

/**
 * Recently deleted, day 30: deletes for good every account whose 30 days are
 * up (purgeDueAccounts, account-deletion.server.ts). Called once a day by
 * pg_cron `account-deletions-purge` while anything is due.
 */
export const Route = createFileRoute("/api/public/hooks/account-deletions-purge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { purgeDueAccounts } = await import("@/lib/account-deletion.server");
        try {
          return Response.json(await purgeDueAccounts(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
