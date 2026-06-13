/**
 * Phase 4A — protected server functions for scheduled and failed messages.
 *
 * Auth: every fn runs under requireSupabaseAuth. The "can message this
 * client" check is enforced by RLS (admins via has_role, coaches via
 * is_assigned_coach) — the insert/RPC simply fails if the caller doesn't
 * have access to that client_id.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const isoUuid = z.string().uuid();

// --------------------------------------------------------------------------
// Schedule a new 1:1 message for future delivery.
// --------------------------------------------------------------------------
export const scheduleMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    clientId: string;
    body: string;
    scheduledAtIso: string;
    scheduledTz?: string | null;
    messageType?: string;
    attachments?: unknown[];
    priority?: string | null;
  }) =>
    z.object({
      clientId: isoUuid,
      body: z.string().min(1).max(8000),
      scheduledAtIso: z.string().min(10),
      scheduledTz: z.string().max(64).nullish(),
      messageType: z.string().max(64).optional(),
      attachments: z.array(z.unknown()).max(20).optional(),
      priority: z.string().max(32).nullish(),
    }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const when = new Date(data.scheduledAtIso);
    if (!Number.isFinite(when.getTime())) {
      throw new Error("Invalid scheduled time");
    }
    if (when.getTime() < Date.now() - 30_000) {
      throw new Error("Scheduled time must be in the future");
    }
    const trimmed = data.body.trim();
    if (!trimmed) throw new Error("Message body cannot be empty");

    // Determine sender role for this user against this client.
    const { data: adminCheck } = await supabase.rpc("has_role", {
      _user_id: userId, _role: "admin",
    });
    const senderRole = adminCheck ? "admin" : "coach";

    const { data: row, error } = await supabase
      .from("messages")
      .insert({
        client_id: data.clientId,
        sender_id: userId,
        sender_role: senderRole,
        body: trimmed,
        attachments: data.attachments ?? [],
        message_type: data.messageType ?? "General",
        is_internal_note: false,
        priority: data.priority ?? null,
        delivery_status: "scheduled",
        scheduled_at: when.toISOString(),
        scheduled_by: userId,
        scheduled_tz: data.scheduledTz ?? null,
        read_by_admin_at: senderRole === "admin" ? new Date().toISOString() : null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// --------------------------------------------------------------------------
// Cancel a scheduled message before the worker picks it up.
// --------------------------------------------------------------------------
export const cancelScheduledMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messageId: string }) =>
    z.object({ messageId: isoUuid }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    // Pull row first to check authorization (admin OR original scheduler).
    const { data: row, error: readErr } = await supabase
      .from("messages")
      .select("id, scheduled_by, sender_id, delivery_status, client_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Message not found");
    if (row.delivery_status !== "scheduled") {
      throw new Error(`Cannot cancel — current status: ${row.delivery_status}`);
    }
    const { data: adminCheck } = await supabase.rpc("has_role", {
      _user_id: userId, _role: "admin",
    });
    if (!adminCheck && row.scheduled_by !== userId && row.sender_id !== userId) {
      throw new Error("Not authorized to cancel this message");
    }
    // Atomic flip; returns 0 rows if the worker has already claimed it.
    const { data: updated, error: rpcErr } = await supabase.rpc(
      "cancel_scheduled_message",
      { _message_id: data.messageId },
    );
    if (rpcErr) throw new Error(rpcErr.message);
    if (!updated || (Array.isArray(updated) && updated.length === 0)) {
      throw new Error("Message is already being sent — cannot cancel");
    }
    await supabase.from("admin_audit_log").insert({
      action: "scheduled_message_cancelled",
      actor_user_id: userId,
      target_table: "messages",
      target_id: data.messageId,
      details: { client_id: row.client_id },
    }).select(); // ignore failure if audit table differs
    return { ok: true };
  });

// --------------------------------------------------------------------------
// Retry a failed message — atomically claim then re-mark as sent.
// --------------------------------------------------------------------------
export const retryFailedMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messageId: string }) =>
    z.object({ messageId: isoUuid }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error: readErr } = await supabase
      .from("messages")
      .select("id, sender_id, scheduled_by, client_id, body, delivery_status, attempt_count")
      .eq("id", data.messageId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Message not found");
    if (row.delivery_status !== "failed") {
      throw new Error(`Cannot retry — current status: ${row.delivery_status}`);
    }
    if (!row.body || !String(row.body).trim()) {
      throw new Error("Cannot retry a message with empty body");
    }
    const { data: adminCheck } = await supabase.rpc("has_role", {
      _user_id: userId, _role: "admin",
    });
    if (!adminCheck && row.sender_id !== userId && row.scheduled_by !== userId) {
      throw new Error("Not authorized to retry this message");
    }

    // Atomically grab the row (race-safe). Second simultaneous click finds
    // delivery_status='sending' and returns 0 rows.
    const { data: claimed, error: claimErr } = await supabase.rpc(
      "claim_message_for_retry",
      { _message_id: data.messageId },
    );
    if (claimErr) throw new Error(claimErr.message);
    const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!claimedRow) {
      throw new Error("Message is already being retried");
    }

    // Mark as delivered (retry is "send now" semantics — the body has not
    // changed since the original failed attempt).
    const { error: finErr } = await supabase.rpc("finalize_message_send", {
      _message_id: data.messageId,
      _status: "sent",
      _error: null,
    });
    if (finErr) {
      // Worst case: row is left in 'sending'. The worker's lease/recovery
      // path will surface it via worker_runs and an operator can re-mark it.
      throw new Error(finErr.message);
    }
    return { ok: true, attempt: claimedRow.attempt_count };
  });