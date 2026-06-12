import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only utility: re-fetch Stripe test-mode events by ID, re-sign with
 * STRIPE_WEBHOOK_SECRET_TEST, and POST them to our public webhook endpoint.
 * Used to replay events that originally failed signature verification.
 */
export const replayStripeTestEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventIds: string[]; webhookUrl?: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const testKey = process.env.STRIPE_SECRET_KEY_TEST?.trim() || null;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST?.trim() || null;
    const liveSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;

    const fp = async (s: string | null) => {
      if (!s) return null;
      const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(h)).slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const diagnostics = {
      test_key_present: !!testKey && testKey.startsWith("sk_test_"),
      webhook_test_secret_present: !!webhookSecret,
      webhook_test_secret_starts_whsec: webhookSecret?.startsWith("whsec_") ?? false,
      webhook_test_secret_length: webhookSecret?.length ?? 0,
      webhook_test_secret_fingerprint: await fp(webhookSecret),
      webhook_live_secret_present: !!liveSecret,
      webhook_live_secret_fingerprint: await fp(liveSecret),
    };

    if (!testKey) throw new Error("STRIPE_SECRET_KEY_TEST not configured or not a test key");
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET_TEST not configured");
    if (!webhookSecret.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET_TEST does not start with whsec_");

    const url = data.webhookUrl || "https://jfeffect.com/api/public/stripe-webhook";

    const signPayload = async (payload: string, ts: number) => {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(webhookSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`));
      return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const results: any[] = [];
    for (const eventId of data.eventIds) {
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
        const v1 = await signPayload(payload, ts);
        const header = `t=${ts},v1=${v1}`;
        const postRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Stripe-Signature": header,
          },
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
    return { diagnostics, results };
  });