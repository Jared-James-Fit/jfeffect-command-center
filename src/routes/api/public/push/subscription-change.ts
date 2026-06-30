import { createFileRoute } from "@tanstack/react-router";

/**
 * Browser rotated a push endpoint. We swap or delete the stored row by the
 * old endpoint. We trust only the URL identity here — there's no bearer
 * token from inside the service worker — and only update rows that already
 * exist (we never create new credentials for a different user).
 */
export const Route = createFileRoute("/api/public/push/subscription-change")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const oldEndpoint = typeof body.oldEndpoint === "string" ? body.oldEndpoint : null;
          const next = body.newSubscription;
          if (!oldEndpoint) return Response.json({ ok: true });
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          if (next?.endpoint && next?.keys?.p256dh && next?.keys?.auth) {
            await supabaseAdmin.from("push_subscriptions")
              .update({
                endpoint: next.endpoint,
                p256dh_key: next.keys.p256dh,
                auth_key: next.keys.auth,
                last_used_at: new Date().toISOString(),
              })
              .eq("endpoint", oldEndpoint);
          } else {
            await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", oldEndpoint);
          }
        } catch (e) {
          console.warn("[push] subscription-change failed", e);
        }
        return Response.json({ ok: true });
      },
    },
  },
});