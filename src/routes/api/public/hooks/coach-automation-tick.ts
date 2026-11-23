import { createFileRoute } from "@tanstack/react-router";

/**
 * Coaching automation's worker: pg_cron calls it every minute while an item
 * is due (`coach-automation-tick`, 20270509100000_cleo_capabilities_recovery_automation.sql),
 * and once a day with `{ "scan": "missed" }` to look for missed sessions first
 * (`coach-automation-missed-scan`, 20270510100000_coaching_automation_categories.sql).
 * Claims and works items for up to ~50 s. See runAutomationTick and
 * scanMissedSessions in src/lib/recovery-automation/run.server.ts.
 */
export const Route = createFileRoute("/api/public/hooks/coach-automation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        let itemId: string | null = null;
        let scan = false;
        try {
          const body = (await request.json()) as { itemId?: unknown; scan?: unknown };
          if (typeof body?.itemId === "string" && /^[0-9a-f-]{36}$/i.test(body.itemId)) itemId = body.itemId;
          scan = body?.scan === "missed";
        } catch {
          // no body: whatever is due
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutomationTick, scanMissedSessions } = await import("@/lib/recovery-automation/run.server");
        try {
          const missed = scan ? await scanMissedSessions(supabaseAdmin as any) : null;
          const tick = await runAutomationTick(supabaseAdmin as any, { itemId });
          return Response.json(missed ? { missed, ...tick } : tick);
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
