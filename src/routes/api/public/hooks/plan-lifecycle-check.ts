import { createFileRoute } from "@tanstack/react-router";

/**
 * Runs plan switching's Stripe calls against Stripe TEST mode on throwaway
 * test-clock customers (stripe-lifecycle-check.server.ts) and reports each
 * step. Refuses without a test key; touches no app data. Call it by hand with
 * the cron hook secret (x-hook-secret) after a deploy.
 */
export const Route = createFileRoute("/api/public/hooks/plan-lifecycle-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const { runStripeLifecycleCheck } = await import("@/lib/plans/stripe-lifecycle-check.server");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const body = (await request.json().catch(() => ({}))) as { part?: string };
          const part = body.part === "core" || body.part === "more" ? body.part : "all";
          return Response.json(await runStripeLifecycleCheck(supabaseAdmin as any, part));
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
