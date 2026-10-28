import { createFileRoute } from "@tanstack/react-router";

/**
 * Nutrition Update AI plans, written in the background: called by the
 * database the moment a plan is queued (`nutrition_ai_plans_queue_run`, with
 * `{ submissionId }`) and by pg_cron every 5 minutes (no id: the oldest
 * waiting or cut-off plan). One plan per call. See runQueuedPlan in
 * src/lib/nutrition-ai-plans.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/nutrition-plans-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        let submissionId: string | null = null;
        try {
          const body = (await request.json()) as { submissionId?: unknown };
          if (
            typeof body?.submissionId === "string" &&
            /^[0-9a-f-]{36}$/i.test(body.submissionId)
          ) {
            submissionId = body.submissionId;
          }
        } catch {
          // no body: take the next waiting plan
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runQueuedPlan } = await import("@/lib/nutrition-ai-plans.server");
        try {
          return Response.json(await runQueuedPlan(supabaseAdmin as any, submissionId));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
