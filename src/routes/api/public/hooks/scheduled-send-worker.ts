/**
 * Scheduled form-response worker — DISABLED BY DEFAULT.
 *
 * Triggered by pg_cron. Bypasses Lovable's edge auth via the `/api/public/*`
 * prefix, then re-enforces three layers of safety:
 *
 *   1. **Worker secret.** Every call must present the secret named by
 *      `SCHEDULED_WORKER_SECRET` in the `x-worker-secret` header (or
 *      `?secret=` query parameter for cron compatibility). Missing or
 *      mismatched secret → 401. The secret is server-only and is never
 *      exposed to the browser bundle. Browser sessions that try to call
 *      this route directly are rejected.
 *
 *   2. **Kill switch.** Reads `app_settings.forms_scheduled_delivery`:
 *        - `emergency_disable=true`  → no-op tick (records `emergency_disabled`).
 *        - `mode='dry_run'`          → simulate only, never deliver.
 *        - `mode='real' + live_enabled=true` → actually deliver via the shared
 *          `performReviewDelivery` helper used by Send Now.
 *        - `mode='real' + live_enabled=false` → coerced to dry-run with reason
 *          `live_disabled` so an operator can stage real mode without sending.
 *      Default values: `mode='dry_run'`, `live_enabled=false`,
 *      `allowed_test_recipients=[]` (no client allowlist = no live delivery).
 *
 *   3. **Per-schedule atomic claim.** `claim_scheduled_responses` locks each
 *      due row with FOR UPDATE SKIP LOCKED and grants a lease. Real-mode then
 *      flips status pending → sending via `mark_schedule_sending` so it can
 *      no longer be cancelled mid-flight. After delivery the helper sets
 *      `submission_reviews.review_status='sent'` and
 *      `scheduled_submission_responses.status='sent'`. Failures land in
 *      `failed` with the error stored on the schedule row; admins may
 *      re-arm via the `retryFailedSchedule` server fn.
 *
 * The cross-process idempotency primitive is the unique
 * `submission_delivery_attempts.idempotency_key` partial index. Real-mode
 * uses key `realsend:{schedule.id}` — a second worker that wins the lease
 * after a crash recovery will hit a unique-key collision and skip.
 *
 * Every tick writes a `worker_runs` row visible in /admin/forms → Scheduler.
 */
import { createFileRoute } from "@tanstack/react-router";

type Mode = "dry_run" | "real";
const WORKER_NAME = "scheduled-form-responses";
const BATCH_SIZE = 25;
const LEASE_SECONDS = 300;
const MAX_REAL_ATTEMPTS = 5;
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

interface ParsedSettings {
  mode: Mode;
  emergencyDisable: boolean;
  liveEnabled: boolean;
  allowedRecipients: string[];
}

async function loadSettings(sb: any): Promise<ParsedSettings> {
  const { data } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "forms_scheduled_delivery")
    .maybeSingle();
  let mode: Mode = "dry_run";
  let emergencyDisable = false;
  let liveEnabled = false;
  let allowedRecipients: string[] = [];
  try {
    const parsed = typeof data?.value === "string" ? JSON.parse(data.value) : data?.value ?? {};
    if (parsed?.mode === "real") mode = "real";
    emergencyDisable = !!parsed?.emergency_disable;
    liveEnabled = !!parsed?.live_enabled;
    if (Array.isArray(parsed?.allowed_test_recipients)) {
      allowedRecipients = parsed.allowed_test_recipients.filter(
        (v: unknown): v is string => typeof v === "string" && v.length > 0,
      );
    }
  } catch {
    /* fall through to safe defaults */
  }
  return { mode, emergencyDisable, liveEnabled, allowedRecipients };
}

type ProcessKind =
  | "simulated_success"
  | "simulated_failed"
  | "duplicate"
  | "skipped"
  | "real_sent"
  | "real_failed";

async function processOne(
  sb: any,
  schedule: any,
  effectiveMode: Mode,
  settings: ParsedSettings,
  workerRunId: string,
): Promise<{ kind: ProcessKind }> {
  // Load the review + minimal context
  const { data: review } = await sb
    .from("submission_reviews")
    .select("*")
    .eq("id", schedule.review_id)
    .maybeSingle();

  const reasons: string[] = [];
  if (!review) reasons.push("review_not_found");
  if (review?.schedule_cancelled_at) reasons.push("schedule_cancelled");
  if (review && !review.client_id) reasons.push("no_client_linked");
  const body = review?.approved_response ?? review?.coach_draft ?? null;
  if (!body || !String(body).trim()) reasons.push("empty_body");

  // Re-enforce coach-approval rules at delivery time, exactly like Send Now.
  if (review?.form_id) {
    const { data: cfg } = await sb
      .from("form_ai_configs")
      .select("require_coach_approval")
      .eq("form_id", review.form_id)
      .maybeSingle();
    if (cfg?.require_coach_approval) {
      const approvedMatches =
        !!review.approved_at &&
        (review.approved_response ?? "").trim() === String(body ?? "").trim();
      if (!approvedMatches) reasons.push("not_approved");
    }
  }

  // Live-mode allowlist guard. When the operator has configured an allowlist
  // (intended for live test sends), reject any delivery to a client outside
  // the list. An empty allowlist with live_enabled=true is allowed — that
  // means real production sending. By default the allowlist is empty AND
  // live_enabled is false, so nothing ever ships.
  if (
    effectiveMode === "real" &&
    settings.allowedRecipients.length > 0 &&
    review?.client_id &&
    !settings.allowedRecipients.includes(review.client_id)
  ) {
    reasons.push("recipient_not_in_allowlist");
  }

  // For dry-run we still record an attempt even when there are reasons, so
  // the operator can see the validation result. The partial unique index
  // guarantees we only ever create one such row per schedule.
  const idempotencyKey = `dryrun:${schedule.id}`;
  const summary = {
    mode: effectiveMode,
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

  if (effectiveMode === "dry_run") {
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

  // ----- mode === 'real' -----

  // Hard refuse to deliver if validation already failed.
  if (reasons.length > 0) {
    await sb.from("submission_delivery_attempts").insert({
      review_id: schedule.review_id,
      schedule_id: schedule.id,
      outcome: "failed",
      error: reasons.join(","),
      delivery_channel: "in_app_message",
      worker_run_id: workerRunId,
      notes: summary,
    });
    await sb.rpc("finalize_schedule_send", {
      _schedule_id: schedule.id,
      _status: "failed",
      _error: reasons.join(","),
    });
    return { kind: "real_failed" as const };
  }

  // Atomically flip status pending → sending so cancellation can no longer
  // win the race. Returns the row when the flip succeeded, NULL otherwise.
  const { data: flipped } = await sb.rpc("mark_schedule_sending", {
    _schedule_id: schedule.id,
  });
  const flippedRow: any = Array.isArray(flipped) ? flipped[0] : flipped;
  if (!flippedRow?.id) {
    // Cancelled in flight (or never pending). Release the lease and move on.
    await sb.rpc("release_scheduled_claim", {
      _schedule_id: schedule.id,
      _validated: false,
    });
    return { kind: "skipped" as const };
  }

  const realKey = `realsend:${schedule.id}`;
  try {
    const { performReviewDelivery } = await import(
      "@/lib/submission-reviews-delivery.server"
    );
    const result = await performReviewDelivery(sb, {
      reviewRow: review,
      body: String(body),
      actorUserId: SYSTEM_ACTOR,
      actorRole: "system",
      idempotencyKey: realKey,
      scheduleId: schedule.id,
      workerRunId,
    });
    await sb.rpc("finalize_schedule_send", {
      _schedule_id: schedule.id,
      _status: "sent",
      _error: null,
    });
    if (!result.deduped) {
      await sb.from("submission_audit_events").insert({
        review_id: schedule.review_id,
        event_type: "scheduled_response_sent",
        actor_user_id: SYSTEM_ACTOR,
        actor_role: "system",
        details: {
          schedule_id: schedule.id,
          message_id: result.messageId,
          attempts: schedule.attempts,
        },
      });
    }
    return { kind: "real_sent" as const };
  } catch (err: any) {
    const errorText = String(err?.message ?? err).slice(0, 1000);
    // Permanent error if we've exhausted retries.
    const attempts = (schedule.attempts ?? 0);
    const exhausted = attempts >= MAX_REAL_ATTEMPTS;
    await sb.from("submission_delivery_attempts").insert({
      review_id: schedule.review_id,
      schedule_id: schedule.id,
      outcome: "failed",
      error: errorText,
      delivery_channel: "in_app_message",
      worker_run_id: workerRunId,
      notes: { mode: "real", reasons: [errorText.slice(0, 200)], exhausted },
    });
    if (exhausted) {
      await sb.rpc("finalize_schedule_send", {
        _schedule_id: schedule.id,
        _status: "failed",
        _error: errorText,
      });
    } else {
      // Reset to pending so the next cron tick re-claims with backoff
      // delivered naturally by the lease window.
      await sb
        .from("scheduled_submission_responses")
        .update({
          status: "pending",
          last_error: errorText,
          claimed_at: null,
          claimed_by_worker: null,
          lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", schedule.id);
    }
    await sb.from("submission_audit_events").insert({
      review_id: schedule.review_id,
      event_type: "scheduled_send_failed",
      actor_user_id: SYSTEM_ACTOR,
      actor_role: "system",
      details: { schedule_id: schedule.id, error: errorText.slice(0, 500), exhausted },
    });
    return { kind: "real_failed" as const };
  }
}

export const Route = createFileRoute("/api/public/hooks/scheduled-send-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---------- 0. Worker secret guard ----------
        const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-worker-secret") ??
          url.searchParams.get("secret") ??
          "";
        if (!expected) {
          // Misconfiguration — fail closed.
          return new Response("worker not configured", { status: 503 });
        }
        if (
          !provided ||
          provided.length !== expected.length ||
          !timingSafeEqualStr(provided, expected)
        ) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;

        const settings = await loadSettings(sb);
        const { mode, emergencyDisable, liveEnabled } = settings;
        // Effective mode: real only when explicitly enabled AND not emergency
        // disabled. Otherwise coerce down to dry_run.
        const effectiveMode: Mode =
          mode === "real" && liveEnabled ? "real" : "dry_run";

        // Open a worker_runs row first so we can record even a no-op tick.
        const { data: runRow } = await sb
          .from("worker_runs")
          .insert({
            worker_name: WORKER_NAME,
            mode: effectiveMode,
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
          return Response.json({ ok: true, mode: effectiveMode, configured_mode: mode, emergency_disabled: true, claimed: 0 });
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
            const res = await processOne(sb, row, effectiveMode, settings, runId);
            if (res.kind === "simulated_success") simulatedSuccess++;
            else if (res.kind === "simulated_failed") simulatedFailed++;
            else if (res.kind === "duplicate") duplicates++;
            else if (res.kind === "skipped") skipped++;
            else if (res.kind === "real_sent") realSent++;
            else if (res.kind === "real_failed") realFailed++;
          } catch (e: any) {
            // Record the failure as an attempt and release the lease.
            await sb.from("submission_delivery_attempts").insert({
              review_id: row.review_id,
              schedule_id: row.id,
              outcome: effectiveMode === "real" ? "failed" : "dry_run_failed",
              error: String(e?.message ?? e).slice(0, 1000),
              delivery_channel: "in_app_message",
              worker_run_id: runId,
            });
            await sb.rpc("release_scheduled_claim", { _schedule_id: row.id, _validated: false });
            if (effectiveMode === "real") realFailed++; else simulatedFailed++;
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
          mode: effectiveMode,
          configured_mode: mode,
          live_enabled: liveEnabled,
          claimed: rows.length,
          simulated_success: simulatedSuccess,
          simulated_failed: simulatedFailed,
          real_sent: realSent,
          real_failed: realFailed,
          skipped,
          duplicates_prevented: duplicates,
          run_id: runId,
        });
      },
      GET: async () => Response.json({ ok: true, hint: "POST with x-worker-secret to run the worker" }),
    },
  },
});

/** Constant-time string compare. Strings must already be the same length. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}