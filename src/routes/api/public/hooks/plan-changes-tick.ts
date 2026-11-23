import { createFileRoute } from "@tanstack/react-router";

/**
 * Plan changes (plans.server.ts runPlanChangesTick): applies downgrades and
 * moves to free on the day the paid month ends, settles upgrades waiting on
 * their charge, expires checkouts nobody finished. pg_cron 'plan-changes-tick'
 * calls it every 10 minutes, only while something waits
 * (20270521090000_plan_switching.sql), with the vault's cron_hook_secret.
 */
export const Route = createFileRoute("/api/public/hooks/plan-changes-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runPlanChangesTick } = await import("@/lib/plans/plans.server");
        try {
          return Response.json(await runPlanChangesTick(supabaseAdmin as any));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
