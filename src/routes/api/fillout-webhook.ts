/**
 * Fillout Webhook Handler — Placeholder
 *
 * This endpoint receives form submission events from Fillout and marks
 * the corresponding nf_assignment as completed.
 *
 * Matching strategy (in priority order):
 *   1. Hidden field `jf_assignment_id` + `jf_client_id` in the Fillout form
 *   2. Fallback: `jf_client_id` + Fillout form ID (most recent incomplete assignment)
 *   3. Email is NOT used as a matching strategy (risk of cross-client leakage)
 *
 * To activate:
 *   1. Set FILLOUT_WEBHOOK_SECRET in Supabase environment variables
 *   2. Configure Fillout webhook URL: https://jfeffect.com/api/fillout-webhook
 *   3. Add hidden fields to each Fillout form:
 *      - jf_assignment_id  (pre-filled with the nf_assignments.id UUID)
 *      - jf_client_id      (pre-filled with the clients.id UUID)
 *
 * Status: ARCHITECTURE READY — awaiting Fillout credentials and form configuration.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const FILLOUT_WEBHOOK_SECRET = process.env.FILLOUT_WEBHOOK_SECRET ?? null;

function getAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key);
}

export const Route = createFileRoute("/api/fillout-webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        // ── 1. Signature verification (activate when secret is configured) ──
        if (FILLOUT_WEBHOOK_SECRET) {
          const signature = request.headers.get("x-fillout-signature") ?? "";
          // TODO_ACTIVATE: Implement HMAC-SHA256 verification here
          void signature;
        }

        // ── 2. Parse payload ─────────────────────────────────────────────────
        let body: Record<string, unknown>;
        try {
          body = await request.json() as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const submissionId: string = String(body?.submissionId ?? body?.id ?? "");
        const formId: string = String(body?.formId ?? "");
        const submittedAt: string = String(body?.submittedAt ?? new Date().toISOString());
        const responses: Array<{ field?: string; label?: string; value?: unknown }> =
          Array.isArray(body?.responses) ? (body.responses as Array<{ field?: string; label?: string; value?: unknown }>) : [];

        if (!submissionId) {
          return new Response("Missing submissionId", { status: 400 });
        }

        // ── 3. Extract hidden matching fields ────────────────────────────────
        function findField(key: string): string | null {
          const r = responses.find(
            (r) => r.field === key || r.label?.toLowerCase() === key.toLowerCase()
          );
          return r?.value != null ? String(r.value).trim() : null;
        }

        const assignmentId = findField("jf_assignment_id");
        const clientId = findField("jf_client_id");

        if (!clientId) {
          console.warn("[fillout-webhook] Missing jf_client_id", { submissionId, formId });
          return new Response(
            JSON.stringify({ success: false, reason: "missing_client_id" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        // ── 4. Mark assignment as completed ──────────────────────────────────
        try {
          const admin = getAdminClient();
          const { data, error } = await (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc(
            "mark_form_assignment_completed",
            {
              p_assignment_id:   assignmentId ?? "00000000-0000-0000-0000-000000000000",
              p_client_id:       clientId,
              p_submission_id:   submissionId,
              p_fillout_form_id: formId || null,
              p_completed_at:    submittedAt,
            }
          );

          if (error) throw error;

          const result = data as { success: boolean; matched_by: string; rows_updated: number };
          console.info("[fillout-webhook] Processed", { submissionId, clientId, assignmentId, result });

          return new Response(
            JSON.stringify({ success: result.success, matched_by: result.matched_by }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("[fillout-webhook] DB error", err);
          return new Response(
            JSON.stringify({ success: false, error: msg }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },

      GET: async () => {
        return new Response(
          JSON.stringify({ status: "ready", endpoint: "fillout-webhook" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      },
    },
  },
  component: () => null,
});
