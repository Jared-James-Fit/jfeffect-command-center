import { createFileRoute } from "@tanstack/react-router";

// Diagnostic-only endpoint. Returns the MODE prefix of the configured Stripe
// secret and confirms the webhook secret is present. Never returns full secrets.
export const Route = createFileRoute("/api/public/stripe-mode-check")({
  server: {
    handlers: {
      GET: async () => {
        const sk = process.env.STRIPE_SECRET_KEY ?? "";
        const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
        let mode: "test" | "live" | "unknown" = "unknown";
        if (sk.startsWith("sk_test_")) mode = "test";
        else if (sk.startsWith("sk_live_")) mode = "live";

        let stripeAccount: any = null;
        let stripeError: string | null = null;
        if (sk) {
          try {
            const r = await fetch("https://api.stripe.com/v1/account", {
              headers: { Authorization: `Bearer ${sk}` },
            });
            const j: any = await r.json();
            if (!r.ok) {
              stripeError = j?.error?.message ?? `HTTP ${r.status}`;
            } else {
              stripeAccount = {
                id: j.id,
                country: j.country,
                email: j.email,
                livemode_capable: j.charges_enabled,
              };
            }
          } catch (e: any) {
            stripeError = e?.message ?? "fetch failed";
          }
        }

        return new Response(
          JSON.stringify({
            secret_key_prefix: sk ? sk.slice(0, 8) : null,
            mode,
            webhook_secret_present: !!whsec,
            webhook_secret_prefix: whsec ? whsec.slice(0, 7) : null,
            stripe_account: stripeAccount,
            stripe_error: stripeError,
          }, null, 2),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});