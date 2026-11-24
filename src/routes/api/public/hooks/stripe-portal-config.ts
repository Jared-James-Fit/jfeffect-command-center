import { createFileRoute } from "@tanstack/react-router";

/**
 * Checks Stripe's billing page (Customer Portal) for each mode and, with
 * { "apply": true }, makes the app's own configuration (card, billing details,
 * invoices; no plan changes or cancels) when it's missing or wrong. Stripe's
 * account default is only read. Call it by hand with the cron hook secret
 * (x-hook-secret). Body: { "apply"?: boolean, "modes"?: ["test", "live"] }.
 */
export const Route = createFileRoute("/api/public/hooks/stripe-portal-config")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = (await request.json().catch(() => ({}))) as { apply?: boolean; modes?: string[] };
        const modes = (Array.isArray(body.modes) ? body.modes : ["test", "live"]).filter((m): m is "test" | "live" => m === "test" || m === "live");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { ensurePortalConfig } = await import("@/lib/plans/billing-portal.server");
        const out = [];
        for (const mode of modes) {
          try {
            out.push(await ensurePortalConfig(supabaseAdmin as any, mode, { apply: !!body.apply }));
          } catch (e: any) {
            out.push({ mode, error: String(e?.message ?? e).slice(0, 300) });
          }
        }
        return Response.json({ ok: true, apply: !!body.apply, reports: out });
      },
    },
  },
});
