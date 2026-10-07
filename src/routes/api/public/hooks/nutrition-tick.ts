import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/nutrition-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorizeWorker(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: targets } = await supabaseAdmin
          .from("nutrition_targets")
          .select("id")
          .neq("status", "Archived");
        let processed = 0;
        for (const t of targets ?? []) {
          await supabaseAdmin.rpc("fn_recompute_nutrition_status", { _target_id: t.id });
          processed++;
        }
        return Response.json({ ok: true, processed });
      },
    },
  },
});

/** Shared hook auth: worker secret (env) or the Vault-held cron secret. */
async function authorizeWorker(request: Request): Promise<boolean> {
  const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
  return authorizeHookRequest(request);
}
