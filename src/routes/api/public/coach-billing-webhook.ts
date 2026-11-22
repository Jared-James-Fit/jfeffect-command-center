import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe → coach seat billing (TEST MODE ONLY). Its own endpoint and signing
 * secret (COACH_BILLING_WEBHOOK_SECRET_TEST), so JF Effect's payment webhook
 * is never asked to understand a coach's subscription; that webhook skips
 * coach seat objects (isCoachSeatsObject). See coach-billing.server.ts.
 */
export const Route = createFileRoute("/api/public/coach-billing-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const { handleCoachBillingWebhook } = await import("@/lib/coach-platform/coach-billing.server");
        const { status, body } = await handleCoachBillingWebhook(raw, request.headers.get("stripe-signature"));
        return Response.json(body, { status });
      },
    },
  },
});
