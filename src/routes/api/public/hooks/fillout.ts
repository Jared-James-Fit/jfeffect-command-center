import { createFileRoute } from "@tanstack/react-router";

/**
 * Fillout webhook receiver.
 *
 * Idempotent. The Fillout `submissionId` is the unique key — duplicate
 * webhook deliveries upsert the same `nf_submissions` row instead of
 * creating a second submission.
 *
 * Configure each Fillout form's webhook to POST here with header:
 *   x-fillout-secret: <FILLOUT_WEBHOOK_SECRET>
 *
 * We look in urlParameters / hiddenFields / questions for:
 *   assignment_id, client_id, form_id, period_start
 * to attach the submission to the exact nf_assignments row. If
 * assignment_id is missing we still try to resolve the assignment from
 * (form_id + client_id). Submissions also continue to be archived in
 * fillout_submissions for the admin "Fillout submissions" review queue.
 */
export const Route = createFileRoute("/api/public/hooks/fillout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-fillout-secret") ?? "";
        const expected = process.env.FILLOUT_WEBHOOK_SECRET ?? "";
        if (!expected || !timingSafeEqualStr(provided, expected)) {
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
        const clientIdParam = getParam("client_id");
        const assignmentIdParam = getParam("assignment_id");
        const formIdParam = getParam("form_id");
        const periodStartParam = getParam("period_start");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Resolve internal form_id, preferring the explicit form_id param.
        let formId: string | null = null;
        let formType: string | null = null;
        if (formIdParam) {
          const { data: f } = await supabaseAdmin
            .from("nf_forms")
            .select("id, form_type")
            .eq("id", formIdParam)
            .maybeSingle();
          if (f) {
            formId = (f as any).id;
            formType = (f as any).form_type ?? null;
          }
        }
        if (!formId && filloutFormId) {
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
        if (!clientIdParam) {
          unmatchReason = "missing_client_id";
        } else {
          const { data: client } = await supabaseAdmin
            .from("clients")
            .select("id")
            .eq("id", clientIdParam)
            .maybeSingle();
          if (client) matchedClientId = client.id;
          else unmatchReason = "client_id_not_found";
        }

        // Resolve nf_assignments row. Prefer the explicit assignment_id param;
        // fall back to (form_id, client_id).
        let assignmentId: string | null = null;
        if (assignmentIdParam) {
          const { data: a } = await supabaseAdmin
            .from("nf_assignments")
            .select("id, form_id, client_id")
            .eq("id", assignmentIdParam)
            .maybeSingle();
          if (a) {
            assignmentId = (a as any).id;
            if (!formId) formId = (a as any).form_id;
            if (!matchedClientId) matchedClientId = (a as any).client_id;
          }
        }
        if (!assignmentId && formId && matchedClientId) {
          const { data: a } = await supabaseAdmin
            .from("nf_assignments")
            .select("id")
            .eq("form_id", formId)
            .eq("client_id", matchedClientId)
            .maybeSingle();
          if (a) assignmentId = (a as any).id;
        }

        // Persist into nf_submissions so every status screen sees this as
        // "submitted". Idempotent via fillout_submission_id unique index.
        if (formId && matchedClientId && filloutSubmissionId) {
          const periodStart =
            periodStartParam ?? (await computeFallbackPeriod(supabaseAdmin, formId));
          const subRow: Record<string, any> = {
            form_id: formId,
            client_id: matchedClientId,
            assignment_id: assignmentId,
            period_start: periodStart,
            status: "submitted",
            submitted_at: submittedAt ?? new Date().toISOString(),
            fillout_submission_id: filloutSubmissionId,
            verification_source: "fillout_webhook",
            started_at: submittedAt ?? new Date().toISOString(),
          };
          const { error: nfErr } = await supabaseAdmin
            .from("nf_submissions")
            .upsert(subRow, { onConflict: "fillout_submission_id" });
          if (nfErr) {
            console.error("[fillout-webhook] nf_submissions upsert failed", nfErr);
            // Don't 500 — we still want the raw payload archived below so the
            // admin queue can pick it up.
          }
        }

        // Always archive raw payload for the admin Fillout review queue.
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
          assignment_id: assignmentId,
          unmatch_reason: unmatchReason,
        });
      },
    },
  },
});

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Compute a fallback period_start when the Fillout submission didn't include
 * one. For weekly/biweekly forms, returns the Monday of the current ISO week;
 * for monthly, the first of the month; for one-off forms, null.
 */
async function computeFallbackPeriod(
  supabaseAdmin: any,
  formId: string,
): Promise<string | null> {
  const { data: form } = await supabaseAdmin
    .from("nf_forms")
    .select("recurrence, recurrence_day")
    .eq("id", formId)
    .maybeSingle();
  if (!form) return null;
  const rec = (form as any).recurrence as string | null;
  if (!rec || rec === "none") return null;
  const d = new Date();
  if (rec === "weekly" || rec === "biweekly") {
    const dayMap: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
      Thursday: 4, Friday: 5, Saturday: 6,
    };
    const target = dayMap[(form as any).recurrence_day ?? "Monday"] ?? 1;
    const dow = d.getDay();
    const diff = (dow - target + 7) % 7;
    d.setDate(d.getDate() - diff);
  } else if (rec === "monthly") {
    d.setDate(1);
  }
  return d.toISOString().slice(0, 10);
}