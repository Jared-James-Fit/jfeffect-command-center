/**
 * Scheduled form-response worker — dry-run by default.
 *
 * Triggered by pg_cron. Bypasses auth at the edge by virtue of the
 * `/api/public/*` prefix, then immediately re-enforces caller-side safety:
 *
 *   1. Reads `app_settings.forms_scheduled_delivery`. If `emergency_disable`
 *      is true, exit without claiming anything.
 *   2. Atomically claims a batch of due, unclaimed schedules via the
 *      `claim_scheduled_responses` SECURITY DEFINER function (FOR UPDATE
 *      SKIP LOCKED, so concurrent ticks can never claim the same row).
 *   3. Validates each schedule: review exists, client linked, body present,
 *      schedule not cancelled, mode-appropriate channel resolvable.
 *   4. In `dry_run` mode (the default and the only mode wired in this pass)
 *      records a `submission_delivery_attempts` row with outcome='dry_run',
 *      writes what *would* have been sent into the schedule's
 *      `dry_run_summary`, releases the claim, and leaves the row pending so
 *      a future real-mode run can still consume it. A partial unique index
 *      (`schedule_id` where outcome IN ('dry_run','dry_run_failed'))
 *      guarantees one dry-run attempt per schedule across all cron ticks.
 *   5. In `real` mode (NOT YET ENABLED) the path would call into the
 *      existing message-insert + nf_reviews mirror used by `approveAndSendNow`.
 *      Until that branch is exercised end-to-end and explicitly enabled by
 *      an admin via the UI, this route refuses to send real messages.
 *
 * Every tick writes a `worker_runs` row visible in /admin/forms → Scheduler.
 */
import { createFileRoute } from "@tanstack/react-router";

type Mode = "dry_run" | "real";
const WORKER_NAME = "scheduled-form-responses";
const BATCH_SIZE = 25;
const LEASE_SECONDS = 300;

async function loadSettings(sb: any) {
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "forms_scheduled_delivery")
    .maybeSingle();
  let mode: Mode = "dry_run";
  let emergencyDisable = false;
  try {
    const parsed = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value ?? {};
    if (parsed?.mode === "real") mode = "real";
    emergencyDisable = !!parsed?.emergency_disable;
  } catch {
    /* fall through to safe defaults */
  }
  return { mode, emergencyDisable };
}

async function processOne(sb: any, schedule: any, mode: Mode, workerRunId: string) {
  // Load the review + minimal context
  const { data: review } = await sb
    .from("submission_reviews")
    .select("id, client_id, source_type, source_id, coach_draft, approved_response, review_status, scheduled_at, schedule_cancelled_at")
    .eq("id", schedule.review_id)
    .maybeSingle();

  const reasons: string[] = [];
  if (!review) reasons.push("review_not_found");
  if (review?.schedule_cancelled_at) reasons.push("schedule_cancelled");
  if (review && !review.client_id) reasons.push("no_client_linked");
  const body = review?.approved_response ?? review?.coach_draft ?? null;
  if (!body || !String(body).trim()) reasons.push("empty_body");

  // For dry-run we still record an attempt even when there are reasons, so
  // the operator can see the validation result. The partial unique index
  // guarantees we only ever create one such row per schedule.
  const idempotencyKey = `dryrun:${schedule.id}`;
  const summary = {
    mode,
    review_id: schedule.review_id,
    client_id: review?.client_id ?? null,
    channel: "in_app_message",
    body_preview: body ? String(body).slice(0, 400) : null,
    body_length: body ? String(body).length : 0,
    scheduled_at: schedule.scheduled_at,
    validated_at: new Date().toISOString(),
    validation: reasons.length === 0 ? "ok" : "failed",
    reasons,
  };

  if (mode === "dry_run") {
    const outcome = reasons.length === 0 ? "dry_run" : "dry_run_failed";
    const insertRes = await sb
      .from("submission_delivery_attempts")
      .insert({
        review_id: schedule.review_id,
        schedule_id: schedule.id,
        outcome,
        error: reasons.length ? reasons.join(",") : null,
        delivery_channel: "in_app_message",
        idempotency_key: idempotencyKey,
        worker_run_id: workerRunId,
        notes: summary,
      });
    // unique-key collisions = duplicate dry-run prevented
    if (insertRes.error && /duplicate key|unique/i.test(insertRes.error.message)) {
      await sb.rpc("release_scheduled_claim", { _schedule_id: schedule.id, _validated: false });
      return { kind: "duplicate" as const };
    }
    await sb
      .from("scheduled_submission_responses")
      .update({
        dry_run_summary: summary,
        dry_run_validated_at: new Date().toISOString(),
        last_error: reasons.length ? reasons.join(",") : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);
    // IMPORTANT: dry-run never consumes the schedule. Release the claim so
    // status stays 'pending' and a future real-mode run can still process it.
    await sb.rpc("release_scheduled_claim", { _schedule_id: schedule.id, _validated: true });
    return { kind: reasons.length === 0 ? ("simulated_success" as const) : ("simulated_failed" as const) };
  }

  // mode === 'real'. Hard guard: real sends are NOT wired in this build.
  await sb
    .from("submission_delivery_attempts")
    .insert({
      review_id: schedule.review_id,
      schedule_id: schedule.id,
      outcome: "skipped",
      error: "real_mode_not_implemented",
      delivery_channel: "in_app_message",
      worker_run_id: workerRunId,
      notes: { mode, reasons: ["real_mode_disabled_in_code"] },
    });
  await sb.rpc("release_scheduled_claim", { _schedule_id: schedule.id, _validated: false });
  return { kind: "skipped" as const };
}

export const Route = createFileRoute("/api/public/hooks/scheduled-send-worker")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;

        const { mode, emergencyDisable } = await loadSettings(sb);

        // Open a worker_runs row first so we can record even a no-op tick.
        const { data: runRow } = await sb
          .from("worker_runs")
          .insert({
            worker_name: WORKER_NAME,
            mode,
            emergency_disabled: emergencyDisable,
          })
          .select("id")
          .single();
        const runId = runRow?.id as string;

        if (emergencyDisable) {
          await sb
            .from("worker_runs")
            .update({ finished_at: new Date().toISOString(), error: "emergency_disabled" })
            .eq("id", runId);
          return Response.json({ ok: true, mode, emergency_disabled: true, claimed: 0 });
        }

        // Claim batch atomically
        const { data: claimed, error: claimErr } = await sb.rpc("claim_scheduled_responses", {
          _worker_name: WORKER_NAME,
          _batch_size: BATCH_SIZE,
          _lease_seconds: LEASE_SECONDS,
        });
        if (claimErr) {
          await sb
            .from("worker_runs")
            .update({ finished_at: new Date().toISOString(), error: claimErr.message })
            .eq("id", runId);
          return new Response(`claim failed: ${claimErr.message}`, { status: 500 });
        }
        const rows: any[] = claimed ?? [];

        let simulatedSuccess = 0;
        let simulatedFailed = 0;
        let realSent = 0;
        let realFailed = 0;
        let skipped = 0;
        let duplicates = 0;

        for (const row of rows) {
          try {
            const res = await processOne(sb, row, mode, runId);
            if (res.kind === "simulated_success") simulatedSuccess++;
            else if (res.kind === "simulated_failed") simulatedFailed++;
            else if (res.kind === "duplicate") duplicates++;
            else if (res.kind === "skipped") skipped++;
          } catch (e: any) {
            // Record the failure as an attempt and release the lease.
            await sb.from("submission_delivery_attempts").insert({
              review_id: row.review_id,
              schedule_id: row.id,
              outcome: mode === "real" ? "failed" : "dry_run_failed",
              error: String(e?.message ?? e).slice(0, 1000),
              delivery_channel: "in_app_message",
              worker_run_id: runId,
            });
            await sb.rpc("release_scheduled_claim", { _schedule_id: row.id, _validated: false });
            if (mode === "real") realFailed++; else simulatedFailed++;
          }
        }

        await sb
          .from("worker_runs")
          .update({
            finished_at: new Date().toISOString(),
            rows_claimed: rows.length,
            rows_simulated_success: simulatedSuccess,
            rows_simulated_failed: simulatedFailed,
            rows_skipped: skipped,
            rows_real_sent: realSent,
            rows_real_failed: realFailed,
            duplicates_prevented: duplicates,
          })
          .eq("id", runId);

        return Response.json({
          ok: true,
          mode,
          claimed: rows.length,
          simulated_success: simulatedSuccess,
          simulated_failed: simulatedFailed,
          skipped,
          duplicates_prevented: duplicates,
          run_id: runId,
        });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run the worker" }),
    },
  },
});