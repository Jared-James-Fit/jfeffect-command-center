import { createFileRoute } from "@tanstack/react-router";

/**
 * Sets up and verifies a monthly coaching package in Stripe (Nutrition
 * Coaching, Coaching Plus): a preview unless the body says { "apply": true }.
 * Called from the database with the vault's cron_hook_secret. Never changes a
 * package's status or listing, an existing Stripe price, or a sale. See
 * setupPackageStripe.
 */
const ALLOWED = new Set(["nutrition", "plus", "complete"]);

export const Route = createFileRoute("/api/public/hooks/coaching-package-stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeHookRequest } = await import("@/lib/hook-auth.server");
        if (!(await authorizeHookRequest(request))) return new Response("unauthorized", { status: 401 });
        const body = await request.json().catch(() => ({}));
        const slugs = (Array.isArray(body?.slugs) ? body.slugs : ["nutrition", "plus"])
          .map((s: unknown) => String(s))
          .filter((s: string) => ALLOWED.has(s));
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { setupPackageStripe } = await import("@/lib/coaching-packages/stripe-setup.server");
        try {
          return Response.json(
            await setupPackageStripe(supabaseAdmin, {
              slugs,
              apply: body?.apply === true,
              // a preview makes nothing in Stripe, not even a checkout to expire
              checkout: body?.checkout === true || (body?.apply === true && body?.checkout !== false),
            }),
          );
        } catch (e: any) {
          return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
