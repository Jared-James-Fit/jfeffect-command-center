import { createFileRoute } from "@tanstack/react-router";

/**
 * Nutrition Update AI plans and the coach's "Change it with AI" on a current
 * plan, written in the background: called by the database the moment one is
 * queued (`nutrition_ai_plans_queue_run` with `{ submissionId }`,
 * `nutrition_plan_edits_queue_run` with `{ editId }`) and by pg_cron every 5
 * minutes (no id: the oldest waiting or cut-off plan, else change). One per
 * call. See runQueuedPlan (nutrition-ai-plans.server.ts) and runQueuedPlanEdit
 * (nutrition-plan-edits.server.ts).
 */
export const Route = createFileRoute("/api/public/hooks/nutrition-plans-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request)))
          return new Response("unauthorized", { status: 401 });
        let submissionId: string | null = null;
        let editId: string | null = null;
        const uuid = (v: unknown) =>
          typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
        try {
          const body = (await request.json()) as { submissionId?: unknown; editId?: unknown };
          submissionId = uuid(body?.submissionId);
          editId = uuid(body?.editId);
        } catch {
          // no body: take the next waiting plan, else the next waiting change
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;
        try {
          if (editId) {
            const { runQueuedPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
            return Response.json(await runQueuedPlanEdit(sb, editId));
          }
          const { runQueuedPlan } = await import("@/lib/nutrition-ai-plans.server");
          const res = await runQueuedPlan(sb, submissionId);
          if (submissionId || res.status !== "idle") return Response.json(res);
          const { runQueuedPlanEdit } = await import("@/lib/nutrition-plan-edits.server");
          return Response.json(await runQueuedPlanEdit(sb, null));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
