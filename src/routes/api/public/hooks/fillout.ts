import { createFileRoute } from "@tanstack/react-router";

/**
 * Fillout webhook receiver.
 *
 * Configure each Fillout form's webhook to POST here with header:
 *   x-fillout-secret: <FILLOUT_WEBHOOK_SECRET>
 *
 * Payload shape (Fillout):
 *   {
 *     formId, formName,
 *     submission: {
 *       submissionId, submissionTime, lastUpdatedAt,
 *       questions: [{ id, name, type, value }, ...],
 *       urlParameters: [{ name, value }, ...]
 *     }
 *   }
 *
 * We pull `client_id` from urlParameters, look up the client, and store the
 * submission. Missing/unknown client_id → unmatched, queued for admin review.
 */
export const Route = createFileRoute("/api/public/hooks/fillout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-fillout-secret") ?? "";
        const expected = process.env.FILLOUT_WEBHOOK_SECRET ?? "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const submission = payload?.submission ?? payload ?? {};
        const filloutSubmissionId: string | null =
          submission?.submissionId ?? payload?.submissionId ?? null;
        const filloutFormId: string | null = payload?.formId ?? submission?.formId ?? null;
        const formName: string | null = payload?.formName ?? null;
        const submittedAt: string | null =
          submission?.submissionTime ?? submission?.lastUpdatedAt ?? null;

        // Extract identity from Fillout urlParameters / hiddenFields / questions
        const urlParams: Array<{ name: string; value: string }> = [
          ...(Array.isArray(submission?.urlParameters) ? submission.urlParameters : []),
          ...(Array.isArray(submission?.hiddenFields) ? submission.hiddenFields : []),
          ...(Array.isArray(submission?.questions) ? submission.questions : []),
        ];
        const getParam = (k: string): string | null => {
          const hit = urlParams.find(
            (p) => (p?.name ?? "").toLowerCase() === k.toLowerCase(),
          );
          return hit?.value ? String(hit.value) : null;
        };
        const clientId = getParam("client_id");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve internal form_id from fillout URL/formId by matching nf_forms.external_url
        let formId: string | null = null;
        let formType: string | null = null;
        if (filloutFormId) {
          const { data: matches } = await supabaseAdmin
            .from("nf_forms")
            .select("id, form_type, external_url")
            .ilike("external_url", `%${filloutFormId}%`)
            .limit(1);
          if (matches && matches.length > 0) {
            formId = matches[0].id as string;
            formType = (matches[0] as any).form_type ?? null;
          }
        }

        // Validate client_id
        let matchedClientId: string | null = null;
        let unmatchReason: string | null = null;
        if (!clientId) {
          unmatchReason = "missing_client_id";
        } else {
          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id")
            .eq("id", clientId)
            .maybeSingle();
          if (client) matchedClientId = client.id;
          else unmatchReason = "client_id_not_found";
        }

        const row = {
          form_id: formId,
          client_id: matchedClientId,
          fillout_submission_id: filloutSubmissionId,
          fillout_form_id: filloutFormId,
          form_type: formType,
          form_name: formName,
          response_json: submission ?? {},
          raw_payload: payload ?? {},
          submitted_at: submittedAt,
          unread: true,
          unmatched: !matchedClientId,
          unmatch_reason: unmatchReason,
        };

        // Upsert on fillout_submission_id when available, otherwise insert.
        const query = filloutSubmissionId
          ? supabaseAdmin
              .from("fillout_submissions")
              .upsert(row, { onConflict: "fillout_submission_id" })
          : supabaseAdmin.from("fillout_submissions").insert(row);
        const { error } = await query;
        if (error) {
          console.error("[fillout-webhook] insert failed", error);
          return new Response(`DB error: ${error.message}`, { status: 500 });
        }

        return Response.json({
          ok: true,
          matched: !!matchedClientId,
          unmatch_reason: unmatchReason,
        });
      },
    },
  },
});