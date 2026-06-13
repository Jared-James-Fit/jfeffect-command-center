/**
 * Shared internal delivery helper for submission review responses.
 *
 * Used by BOTH:
 *   - Send Now (`approveAndSendNow`) — caller has already authorized the user
 *     and enforced `require_coach_approval`.
 *   - Scheduled-send worker — caller is the cron-triggered worker route which
 *     authenticates via a server-only secret, runs as an internal system
 *     actor, and has re-enforced approval before invoking this helper.
 *
 * This helper performs ONLY delivery-mechanism work:
 *   - Idempotency dedupe via `submission_reviews.send_idempotency_key`
 *   - Message insert into `messages`
 *   - `submission_reviews` state transition to `sent`
 *   - Delivery attempt row (unique by `idempotency_key`)
 *   - Audit event
 *   - Native-source mirror into `nf_reviews` / `nf_submissions`
 *
 * It does NOT perform authorization or approval checks — those MUST be done
 * by the caller. This separation is intentional so that Send Now and the
 * scheduled worker share identical wire-level behavior.
 *
 * SERVER-ONLY. Never import from route components — `*.server.ts` files are
 * stripped from client bundles by the Vite plugin.
 */

export type DeliveryActorRole = "coach" | "admin" | "system";

export interface PerformDeliveryOpts {
  reviewRow: any;
  body: string;
  actorUserId: string; // for system delivery use the all-zero UUID
  actorRole: DeliveryActorRole;
  idempotencyKey: string;
  /** Schedule row id when invoked from the worker; null for Send Now. */
  scheduleId?: string | null;
  workerRunId?: string | null;
}

export interface PerformDeliveryResult {
  ok: true;
  messageId: string;
  deduped: boolean;
}

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

/**
 * Run the actual delivery. Returns `{ deduped: true }` when the review's
 * `send_idempotency_key` already matches and a message id is recorded.
 */
export async function performReviewDelivery(
  sb: any,
  opts: PerformDeliveryOpts,
): Promise<PerformDeliveryResult> {
  const { reviewRow: row, body, actorUserId, actorRole, idempotencyKey } = opts;

  if (!row?.id) throw new Error("performReviewDelivery: missing review row");
  if (!row.client_id) throw new Error("Review is not linked to a client");
  if (!body || !String(body).trim()) throw new Error("Empty response body");

  // Idempotency: same key produced a successful delivery → return existing.
  if (
    row.send_idempotency_key === idempotencyKey &&
    row.latest_message_id
  ) {
    return { ok: true, messageId: row.latest_message_id, deduped: true };
  }

  // Optimistically mark sending. Concurrent worker ticks rely on
  // `mark_schedule_sending` (status flip) for cross-process dedupe.
  await sb
    .from("submission_reviews")
    .update({
      review_status: "sending",
      send_idempotency_key: idempotencyKey,
    })
    .eq("id", row.id);

  const senderId = actorUserId || SYSTEM_ACTOR;

  const { data: msg, error: msgErr } = await sb
    .from("messages")
    .insert({
      client_id: row.client_id,
      sender_id: senderId,
      sender_role: actorRole === "system" ? "admin" : actorRole,
      body,
      attachments: [],
      message_type: row.source_type === "application" ? "General" : "Check-In",
      is_internal_note: false,
      read_by_admin_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (msgErr || !msg) throw msgErr ?? new Error("Message insert failed");

  await sb
    .from("submission_reviews")
    .update({
      review_status: "sent",
      approved_response: row.approved_response ?? body,
      delivered_response: body,
      latest_message_id: msg.id,
      approved_at: row.approved_at ?? new Date().toISOString(),
      approved_by: row.approved_by ?? senderId,
      sent_at: new Date().toISOString(),
      sent_by: senderId,
      last_delivery_error: null,
    })
    .eq("id", row.id);

  // Attempt log — idempotency_key column has a unique partial index.
  const attemptInsert = await sb
    .from("submission_delivery_attempts")
    .insert({
      review_id: row.id,
      schedule_id: opts.scheduleId ?? null,
      outcome: "success",
      message_id: msg.id,
      initiated_by: senderId,
      delivery_channel: "in_app_message",
      idempotency_key: idempotencyKey,
      worker_run_id: opts.workerRunId ?? null,
    });
  // Duplicate-key here is benign — another concurrent path already logged
  // this exact delivery. We still return the message we just produced.
  if (
    attemptInsert.error &&
    !/duplicate key|unique/i.test(attemptInsert.error.message ?? "")
  ) {
    throw attemptInsert.error;
  }

  await sb.from("submission_audit_events").insert({
    review_id: row.id,
    event_type: "response_sent",
    actor_user_id: senderId,
    actor_role: actorRole,
    details: {
      message_id: msg.id,
      schedule_id: opts.scheduleId ?? null,
      via: opts.scheduleId ? "scheduled_worker" : "send_now",
    },
  });

  // Backwards compat mirror for native check-ins.
  if (row.source_type === "native") {
    await sb.from("nf_reviews").insert({
      submission_id: row.source_id,
      reviewer_user_id: senderId,
      reply_text: body,
      message_id: msg.id,
      sent_to_messenger_at: new Date().toISOString(),
    });
    await sb
      .from("nf_submissions")
      .update({
        status: "reviewed",
        reviewed_at: new Date().toISOString(),
        reviewed_by: senderId,
      })
      .eq("id", row.source_id);
  }

  return { ok: true, messageId: msg.id, deduped: false };
}

/** Record a failed delivery attempt and flip the review into delivery_failed. */
export async function recordDeliveryFailure(
  sb: any,
  reviewId: string,
  err: unknown,
  initiatedBy: string,
  scheduleId?: string | null,
  workerRunId?: string | null,
) {
  const message = String((err as any)?.message ?? err).slice(0, 1000);
  await sb
    .from("submission_reviews")
    .update({
      review_status: "delivery_failed",
      last_delivery_error: message,
    })
    .eq("id", reviewId);
  await sb.from("submission_delivery_attempts").insert({
    review_id: reviewId,
    schedule_id: scheduleId ?? null,
    outcome: "failed",
    error: message,
    initiated_by: initiatedBy || SYSTEM_ACTOR,
    delivery_channel: "in_app_message",
    worker_run_id: workerRunId ?? null,
  });
  await sb.from("submission_audit_events").insert({
    review_id: reviewId,
    event_type: "delivery_failed",
    actor_user_id: initiatedBy || SYSTEM_ACTOR,
    actor_role: initiatedBy ? "coach" : "system",
    details: { error: message.slice(0, 500), schedule_id: scheduleId ?? null },
  });
}
