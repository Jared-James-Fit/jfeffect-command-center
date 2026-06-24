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
 *   4. Remove the TODO_ACTIVATE comment below and uncomment the signature verification
 *
 * Status: ARCHITECTURE READY — awaiting Fillout credentials and form configuration.
 */

import { createAPIFileRoute } from "@tanstack/react-start/api";
import { supabase as adminSupabase } from "@/integrations/supabase/client";

// TODO_ACTIVATE: Set this in Supabase env vars when Fillout is configured
const FILLOUT_WEBHOOK_SECRET = process.env.FILLOUT_WEBHOOK_SECRET ?? null;

export const APIRoute = createAPIFileRoute("/api/fillout-webhook")({
  POST: async ({ request }) => {
    // ── 1. Signature verification (activate when secret is configured) ──────
    if (FILLOUT_WEBHOOK_SECRET) {
      const signature = request.headers.get("x-fillout-signature") ?? "";
      // TODO_ACTIVATE: Implement HMAC-SHA256 verification here
      // const isValid = verifyFilloutSignature(await request.text(), signature, FILLOUT_WEBHOOK_SECRET);
      // if (!isValid) return new Response("Unauthorized", { status: 401 });
    }

    // ── 2. Parse payload ─────────────────────────────────────────────────────
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Fillout webhook payload structure:
    // { submissionId, formId, submittedAt, responses: [{ field, value }] }
    const submissionId: string = body?.submissionId ?? body?.id ?? "";
    const formId: string = body?.formId ?? "";
    const submittedAt: string = body?.submittedAt ?? new Date().toISOString();
    const responses: { field?: string; label?: string; value?: any }[] = body?.responses ?? [];

    if (!submissionId) {
      return new Response("Missing submissionId", { status: 400 });
    }

    // ── 3. Extract hidden matching fields from responses ─────────────────────
    function findField(key: string): string | null {
      const r = responses.find(
        (r) => r.field === key || r.label?.toLowerCase() === key.toLowerCase()
      );
      return r?.value ? String(r.value).trim() : null;
    }

    const assignmentId = findField("jf_assignment_id");
    const clientId = findField("jf_client_id");

    if (!clientId) {
      // Cannot match without client_id — log and return 200 to prevent Fillout retries
      console.warn("[fillout-webhook] Missing jf_client_id in submission", { submissionId, formId });
      return new Response(
        JSON.stringify({ success: false, reason: "missing_client_id" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── 4. Mark assignment as completed ──────────────────────────────────────
    try {
      const { data, error } = await (adminSupabase as any).rpc("mark_form_assignment_completed", {
        p_assignment_id:   assignmentId ?? "00000000-0000-0000-0000-000000000000",
        p_client_id:       clientId,
        p_submission_id:   submissionId,
        p_fillout_form_id: formId || null,
        p_completed_at:    submittedAt,
      });

      if (error) throw error;

      const result = data as { success: boolean; matched_by: string; rows_updated: number };
      console.info("[fillout-webhook] Processed", { submissionId, clientId, assignmentId, result });

      return new Response(
        JSON.stringify({ success: result.success, matched_by: result.matched_by }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      console.error("[fillout-webhook] DB error", err);
      return new Response(
        JSON.stringify({ success: false, error: err?.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },

  // Fillout may send HEAD requests to verify the endpoint
  GET: async () => {
    return new Response(
      JSON.stringify({ status: "ready", endpoint: "fillout-webhook" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  },
});
