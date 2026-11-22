import { createFileRoute } from "@tanstack/react-router";

/**
 * Coach seat billing housekeeping, run by the database or by hand
 * (x-hook-secret). TEST MODE ONLY.
 *
 * - POST {}: every workspace with billing: quantities brought in step with
 *   paid clients (prorated, idempotent per seat revision) and the row
 *   reconciled with its Stripe subscription (status, period, item).
 * - POST { orgId }: one workspace.
 *
 * Never charges anyone directly: Stripe invoices on its own schedule.
 */
export const Route = createFileRoute("/api/public/hooks/coach-billing-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as any;
        try {
          const m = await import("@/lib/coach-platform/coach-billing.server");
          if (typeof body?.orgId === "string") return Response.json({ results: [await m.reconcileWorkspace(body.orgId)] });
          return Response.json({ results: await m.reconcileAllWorkspaces() });
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
