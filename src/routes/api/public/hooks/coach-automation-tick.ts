import { createFileRoute } from "@tanstack/react-router";

/**
 * Recovery automation's worker: pg_cron calls it every minute while an item
 * is due (`coach-automation-tick`, 20270509100000_cleo_capabilities_recovery_automation.sql).
 * Claims and works items for up to ~50 s. See runAutomationTick in
 * src/lib/recovery-automation/run.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/coach-automation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let itemId: string | null = null;
        try {
          const body = (await request.json()) as { itemId?: unknown };
          if (typeof body?.itemId === "string" && /^[0-9a-f-]{36}$/i.test(body.itemId)) itemId = body.itemId;
        } catch {
          // no body: whatever is due
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutomationTick } = await import("@/lib/recovery-automation/run.server");
        try {
          return Response.json(await runAutomationTick(supabaseAdmin as any, { itemId }));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
