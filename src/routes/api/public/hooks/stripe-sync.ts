import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe → app, run by the database (x-hook-secret).
 *
 * - POST { all: true } (pg_cron `stripe-sync-daily`): the account sync over the
 *   last `days` (default 45): every paid checkout, invoice and payment Stripe
 *   holds that the app is missing is recorded on the sale it pays (a session
 *   package's auto-pay pays the oldest owed package first), then each live
 *   subscription's status and next charge date are refreshed. The webhook does
 *   all of this as it happens; this catches anything it missed.
 * - POST { clientId, audit: true }: one client's Stripe (customers,
 *   subscriptions, invoices, charges, checkout sessions) beside their sales and
 *   payment rows, read-only.
 *
 * Read-only against Stripe: nothing is charged, refunded or changed there.
 */
export const Route = createFileRoute("/api/public/hooks/stripe-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as any;
        const mode = body?.mode === "test" ? "test" : "live";
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          if (body?.all) {
            const days = Math.max(1, Math.min(400, Number(body.days) || 45));
            const { runStripeAccountSync } = await import("@/lib/stripe-account-sync.server");
            const { refreshSubscriptions } = await import("@/lib/stripe-client-sync.server");
            const sync: any = await runStripeAccountSync(supabaseAdmin as any, { mode, days });
            const subscriptions = await refreshSubscriptions(supabaseAdmin as any, mode);
            const notable = (sync?.entries ?? []).filter((e: any) => e.action !== "no_change");
            return Response.json({ ok: sync?.ok ?? false, error: sync?.error ?? null, counts: sync?.counts ?? null, recorded: notable, subscriptions });
          }
          const clientId = typeof body?.clientId === "string" ? body.clientId : null;
          if (!clientId || !body?.audit) {
            return Response.json({ error: "all: true, or clientId with audit: true, is required" }, { status: 400 });
          }
          const { auditClientStripe } = await import("@/lib/stripe-client-sync.server");
          return Response.json(await auditClientStripe(supabaseAdmin as any, clientId, mode));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
