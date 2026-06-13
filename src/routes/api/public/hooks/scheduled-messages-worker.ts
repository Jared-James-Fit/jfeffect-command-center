/**
 * Scheduled 1:1 messages worker — DISABLED BY DEFAULT.
 *
 * Triggered by pg_cron. Same safety contract as the AI-review worker:
 *   1. Worker secret (x-worker-secret / ?secret=)
 *   2. Kill switch app_settings.messages_scheduled_delivery
 *      - emergency_disable=true → no-op
 *      - mode='dry_run' → validate only, do not deliver
 *      - mode='real' + live_enabled=true → deliver
 *   3. Per-row atomic claim via claim_scheduled_messages (FOR UPDATE SKIP
 *      LOCKED + lease). Delivery flips status 'scheduled' → 'sending' →
 *      'sent'; a second worker that wins the race after a crash finds
 *      delivery_status='sending' and skips.
 *
 * Idempotency: the row IS the schedule, so a successful finalize_message_send
 * leaves it in 'sent' and no subsequent claim can match
 * delivery_status='scheduled'.
 */
import { createFileRoute } from "@tanstack/react-router";

type Mode = "dry_run" | "real";
const WORKER_NAME = "scheduled-messages";
const BATCH_SIZE = 25;
const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 5;

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
    .eq("key", "messages_scheduled_delivery")
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

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function processOne(
  sb: any,
  row: any,
  effectiveMode: Mode,
  settings: ParsedSettings,
): Promise<"dry_ok" | "dry_failed" | "real_sent" | "real_failed" | "skipped"> {
  const reasons: string[] = [];
  const body = (row.body ?? "").toString();
  if (!body.trim()) reasons.push("empty_body");
  if (!row.client_id) reasons.push("no_client");
  if (
    effectiveMode === "real" &&
    settings.allowedRecipients.length > 0 &&
    row.client_id &&
    !settings.allowedRecipients.includes(row.client_id)
  ) {
    reasons.push("recipient_not_in_allowlist");
  }

  // DRY-RUN: do not consume the row. Record validation in delivery_error
  // so admins can see why it would have failed, then release the claim
  // back to 'scheduled'.
  if (effectiveMode === "dry_run") {
    await sb
      .from("messages")
      .update({
        delivery_error: reasons.length ? `dry_run:${reasons.join(",")}` : "dry_run:ok",
        claimed_at: null,
        claimed_by_worker: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return reasons.length === 0 ? "dry_ok" : "dry_failed";
  }

  // REAL MODE
  if (reasons.length > 0) {
    await sb.rpc("finalize_message_send", {
      _message_id: row.id,
      _status: "failed",
      _error: reasons.join(","),
    });
    return "real_failed";
  }

  // Atomic flip 'scheduled' → 'sending' so cancellation can no longer win.
  const { data: flipped } = await sb.rpc("mark_message_sending", {
    _message_id: row.id,
  });
  const flippedRow = Array.isArray(flipped) ? flipped[0] : flipped;
  if (!flippedRow?.id) {
    // Cancelled / already taken / already sent.
    await sb.rpc("release_message_claim", { _message_id: row.id });
    return "skipped";
  }

  try {
    await sb.rpc("finalize_message_send", {
      _message_id: row.id,
      _status: "sent",
      _error: null,
    });
    return "real_sent";
  } catch (err: any) {
    const errorText = String(err?.message ?? err).slice(0, 1000);
    const attempts = row.attempt_count ?? 0;
    const exhausted = attempts >= MAX_ATTEMPTS;
    if (exhausted) {
      await sb.rpc("finalize_message_send", {
        _message_id: row.id,
        _status: "failed",
        _error: errorText,
      });
    } else {
      // Reset to scheduled so the next tick re-claims naturally.
      await sb
        .from("messages")
        .update({
          delivery_status: "scheduled",
          delivery_error: errorText,
          claimed_at: null,
          claimed_by_worker: null,
          lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    return "real_failed";
  }
}

export const Route = createFileRoute("/api/public/hooks/scheduled-messages-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SCHEDULED_WORKER_SECRET ?? "";
        const url = new URL(request.url);
        const provided =
          request.headers.get("x-worker-secret") ??
          url.searchParams.get("secret") ??
          "";
        if (!expected) return new Response("worker not configured", { status: 503 });
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
        const effectiveMode: Mode =
          mode === "real" && liveEnabled ? "real" : "dry_run";

        const { data: runRow } = await sb
          .from("worker_runs")
          .insert({
            worker_name: WORKER_NAME,
            mode: effectiveMode,
            emergency_disabled: emergencyDisable,
          })
          .select("id")
          .single();
        const runId = runRow?.id as string | undefined;

        if (emergencyDisable) {
          if (runId) {
            await sb
              .from("worker_runs")
              .update({
                finished_at: new Date().toISOString(),
                error: "emergency_disabled",
              })
              .eq("id", runId);
          }
          return Response.json({
            ok: true, mode: effectiveMode, emergency_disabled: true, claimed: 0,
          });
        }

        const { data: claimed, error: claimErr } = await sb.rpc(
          "claim_scheduled_messages",
          {
            _worker_name: WORKER_NAME,
            _batch_size: BATCH_SIZE,
            _lease_seconds: LEASE_SECONDS,
          },
        );
        if (claimErr) {
          if (runId) {
            await sb
              .from("worker_runs")
              .update({ finished_at: new Date().toISOString(), error: claimErr.message })
              .eq("id", runId);
          }
          return new Response(`claim failed: ${claimErr.message}`, { status: 500 });
        }
        const rows: any[] = claimed ?? [];

        let dryOk = 0;
        let dryFailed = 0;
        let realSent = 0;
        let realFailed = 0;
        let skipped = 0;

        for (const r of rows) {
          try {
            const kind = await processOne(sb, r, effectiveMode, settings);
            if (kind === "dry_ok") dryOk++;
            else if (kind === "dry_failed") dryFailed++;
            else if (kind === "real_sent") realSent++;
            else if (kind === "real_failed") realFailed++;
            else if (kind === "skipped") skipped++;
          } catch (e: any) {
            // Release the lease so the next tick can retry.
            await sb.rpc("release_message_claim", { _message_id: r.id });
            if (effectiveMode === "real") realFailed++; else dryFailed++;
          }
        }

        if (runId) {
          await sb
            .from("worker_runs")
            .update({
              finished_at: new Date().toISOString(),
              rows_claimed: rows.length,
              rows_simulated_success: dryOk,
              rows_simulated_failed: dryFailed,
              rows_real_sent: realSent,
              rows_real_failed: realFailed,
              rows_skipped: skipped,
            })
            .eq("id", runId);
        }

        return Response.json({
          ok: true,
          mode: effectiveMode,
          claimed: rows.length,
          dry_ok: dryOk,
          dry_failed: dryFailed,
          real_sent: realSent,
          real_failed: realFailed,
          skipped,
        });
      },
    },
  },
});