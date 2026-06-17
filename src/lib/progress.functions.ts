import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Marks a progress submission as awaiting_review and — for coaching client
 * submissions only — opens an inbox alert for the assigned coach (or any
 * admin) so they see new progress in the Support Alerts dashboard.
 * Members submitting self-tracked progress do NOT enter any coach queue
 * (matches the chosen "self-tracking only" membership setting).
 */
export const submitProgressForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { submissionId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();

    const { data: submission, error: subErr } = await (supabase as any)
      .from("progress_submissions")
      .select("id, owner_type, client_id, assigned_coach_id, submission_type, check_in_label")
      .eq("id", data.submissionId)
      .single();
    if (subErr) throw subErr;
    if (!submission) throw new Error("Submission not found.");

    const targetStatus =
      submission.owner_type === "client" ? "awaiting_review" : "self_tracking";

    const { error: updErr } = await (supabase as any)
      .from("progress_submissions")
      .update({ review_status: targetStatus, submitted_at: now })
      .eq("id", data.submissionId);
    if (updErr) throw updErr;

    // Coaching clients only — fire a best-effort support alert so the
    // assigned coach (or any admin) sees the submission in the inbox.
    if (submission.owner_type === "client" && submission.client_id) {
      try {
        const { data: client } = await (supabase as any)
          .from("clients")
          .select("full_name")
          .eq("id", submission.client_id)
          .maybeSingle();
        const clientName = client?.full_name ?? "A coaching client";
        const label = submission.check_in_label ?? "Progress Check-In";
        await (supabase as any).from("support_alerts").insert({
          client_id: submission.client_id,
          coach_id: submission.assigned_coach_id ?? userId,
          error_type: "progress_submission",
          error_message: `${clientName} submitted ${label} (${submission.submission_type})`,
          details: {
            submission_id: submission.id,
            submission_type: submission.submission_type,
            check_in_label: submission.check_in_label,
          },
        });
      } catch (e: any) {
        // Non-fatal — submission already saved.
        console.warn("[progress submit] support_alert insert failed", e?.message ?? e);
      }
    }

    return { ok: true, review_status: targetStatus };
  });

/** Admin retry for a stuck Drive sync on a single progress media row. */
export const retryProgressDriveSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mediaId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await (context.supabase as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { archiveProgressMediaToDrive } = await import("./progress-archive.server");
    return archiveProgressMediaToDrive(data.mediaId);
  });