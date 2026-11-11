import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe → app, for one client, run by the database (x-hook-secret).
 *
 * POST { clientId, mode?: "live" | "test", audit: true } lists what Stripe
 * holds for that client (their customers' subscriptions, invoices, charges and
 * checkout sessions) beside the app's own sales and payment rows, so a
 * package's payment status can be checked against what actually moved. It is
 * read-only against Stripe and the app; nothing is charged, changed or written.
 */
export const Route = createFileRoute("/api/public/hooks/stripe-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => null)) as any;
        const clientId = typeof body?.clientId === "string" ? body.clientId : null;
        if (!clientId || !body?.audit) {
          return Response.json({ error: "clientId and audit: true are required" }, { status: 400 });
        }
        const mode = body.mode === "test" ? "test" : "live";
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { auditClientStripe } = await import("@/lib/stripe-client-sync.server");
          return Response.json(await auditClientStripe(supabaseAdmin as any, clientId, mode));
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
