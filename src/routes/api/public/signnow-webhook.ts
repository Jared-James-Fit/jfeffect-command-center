import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * SignNow webhook receiver.
 *
 * Security: requires HMAC-SHA256 signature in `x-signnow-signature` header,
 * computed against the raw request body using SIGNNOW_WEBHOOK_SECRET.
 * Hex or base64 signatures are both accepted.
 *
 * Configure in SignNow dashboard → Settings → Webhooks → Add:
 *   URL:    https://<your-domain>/api/public/signnow-webhook
 *   Events: document.complete, document.cancel, document.field-invite,
 *           invite.signer.complete (subscribe to at least document.complete)
 */
export const Route = createFileRoute("/api/public/signnow-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SIGNNOW_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Webhook not configured", { status: 503 });
        }
        const provided = request.headers.get("x-signnow-signature") || request.headers.get("x-webhook-signature");
        const body = await request.text();
        if (!provided) {
          return new Response("Missing signature", { status: 401 });
        }
        const expected = createHmac("sha256", secret).update(body).digest();
        const cleanProvided = provided.replace(/^sha256=/i, "");
        let providedBuf: Buffer | null = null;
        try {
          if (/^[a-f0-9]+$/i.test(cleanProvided) && cleanProvided.length === expected.length * 2) {
            providedBuf = Buffer.from(cleanProvided, "hex");
          } else {
            providedBuf = Buffer.from(cleanProvided, "base64");
          }
        } catch {
          providedBuf = null;
        }
        if (!providedBuf || providedBuf.length !== expected.length || !timingSafeEqual(providedBuf, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(body); } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const documentId =
          payload?.meta?.id ||
          payload?.meta?.document_id ||
          payload?.document_id ||
          payload?.data?.id ||
          payload?.id ||
          null;
        const event: string = payload?.event_type || payload?.event || "unknown";

        if (!documentId) {
          return new Response(JSON.stringify({ ok: true, ignored: "no document id" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }

        const { findAgreementByDocumentId, pullSignedDocumentForAgreement } =
          await import("@/lib/agreements-pull.server");

        const agreementId = await findAgreementByDocumentId(String(documentId));
        if (!agreementId) {
          // Unknown doc; still 200 so SignNow doesn't keep retrying.
          return new Response(JSON.stringify({ ok: true, ignored: "unknown document" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }

        try {
          const result = await pullSignedDocumentForAgreement(agreementId, { event });
          return new Response(JSON.stringify({ ok: true, event, result }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          // Still 200 so the queue doesn't pile up; we log internally.
          console.error("[signnow-webhook] pull failed", e?.message);
          return new Response(JSON.stringify({ ok: false, error: e?.message ?? "pull failed" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});