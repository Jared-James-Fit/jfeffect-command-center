import { createFileRoute } from "@tanstack/react-router";

/**
 * One-time admin debug endpoint: re-fetches Stripe TEST-mode events by ID,
 * re-signs the raw payload using STRIPE_WEBHOOK_SECRET_TEST, and POSTs each
 * to our public webhook so the standard pipeline runs end-to-end.
 *
 * Random path acts as a single-use shared secret; this file is deleted
 * immediately after invocation.
 */

const EVENT_IDS = [
  "evt_1ThIF4LbCrxASxtbrnjmibJf",
  "evt_1ThIF4LbCrxASxtbTmhGyQqT",
  "evt_1ThIPmLbCrxASxtbc67cyU2J",
];

async function fp(s: string | null) {
  if (!s) return null;
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/__replay-73ae9c8e4bcdc04ea9fd65f84f0752da")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const testKey = process.env.STRIPE_SECRET_KEY_TEST?.trim() || null;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim() || null;
        const liveSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;

        const diagnostics = {
          test_key_present: !!testKey && testKey.startsWith("sk_test_"),
          webhook_test_secret_present: !!webhookSecret,
          webhook_test_secret_starts_whsec: webhookSecret?.startsWith("whsec_") ?? false,
          webhook_test_secret_length: webhookSecret?.length ?? 0,
          webhook_test_secret_fingerprint: await fp(webhookSecret),
          webhook_live_secret_present: !!liveSecret,
          webhook_live_secret_fingerprint: await fp(liveSecret),
        };

        if (!testKey || !webhookSecret || !webhookSecret.startsWith("whsec_")) {
          return Response.json({ ok: false, diagnostics, error: "missing/invalid test secrets" }, { status: 503 });
        }

        const origin = new URL(request.url).origin;
        const webhookUrl = `${origin}/api/public/stripe-webhook`;

        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(webhookSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );

        const results: any[] = [];
        for (const eventId of EVENT_IDS) {
          try {
            const evRes = await fetch(`https://api.stripe.com/v1/events/${eventId}`, {
              headers: { Authorization: `Bearer ${testKey}` },
            });
            const evJson: any = await evRes.json();
            if (!evRes.ok) {
              results.push({ eventId, ok: false, stage: "fetch", status: evRes.status, error: evJson?.error?.message });
              continue;
            }
            const payload = JSON.stringify(evJson);
            const ts = Math.floor(Date.now() / 1000);
            const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`));
            const v1 = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
            const header = `t=${ts},v1=${v1}`;
            const postRes = await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Stripe-Signature": header },
              body: payload,
            });
            const body = await postRes.text();
            results.push({
              eventId,
              ok: postRes.ok,
              status: postRes.status,
              response: body,
              livemode: evJson?.livemode,
              type: evJson?.type,
            });
          } catch (e: any) {
            results.push({ eventId, ok: false, stage: "post", error: e?.message ?? String(e) });
          }
        }
        return Response.json({ ok: true, diagnostics, results });
      },
    },
  },
});