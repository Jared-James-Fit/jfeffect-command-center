/**
 * Server functions for the scheduled-send worker control panel.
 *
 * All write operations are admin-only. Mode changes and emergency-disable
 * toggles are recorded in `scheduler_mode_audit` with the actor and reason.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden — admin only");
}

function parseSettings(raw: any): {
  mode: "dry_run" | "real";
  emergency_disable: boolean;
  live_enabled: boolean;
  allowed_test_recipients: string[];
  updated_at: string | null;
  updated_by: string | null;
  notes: string | null;
} {
  let v: any = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { v = {}; }
  }
  const recipients = Array.isArray(v?.allowed_test_recipients)
    ? v.allowed_test_recipients.filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0,
      )
    : [];
  return {
    mode: v?.mode === "real" ? "real" : "dry_run",
    emergency_disable: !!v?.emergency_disable,
    live_enabled: !!v?.live_enabled,
    allowed_test_recipients: recipients,
    updated_at: v?.updated_at ?? null,
    updated_by: v?.updated_by ?? null,
    notes: v?.notes ?? null,
  };
}

function settingsToValue(s: ReturnType<typeof parseSettings>) {
  return JSON.stringify({
    mode: s.mode,
    emergency_disable: s.emergency_disable,
    live_enabled: s.live_enabled,
    allowed_test_recipients: s.allowed_test_recipients,
    updated_at: s.updated_at,
    updated_by: s.updated_by,
    notes: s.notes,
  });
}

export const getSchedulerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isCoach } = await context.supabase.rpc("is_coach_or_admin", {
      _user_id: context.userId,
    });
    if (!isCoach) throw new Error("Forbidden");
    const sb = await admin();

    const { data: setting } = await sb
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "forms_scheduled_delivery")
      .maybeSingle();
    const parsed = parseSettings(setting?.value);

    const { data: lastRuns } = await sb
      .from("worker_runs")
      .select("*")
      .eq("worker_name", "scheduled-form-responses")
      .order("started_at", { ascending: false })
      .limit(20);

    // 24h aggregate
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: agg } = await sb
      .from("worker_runs")
      .select(
        "rows_claimed, rows_simulated_success, rows_simulated_failed, rows_skipped, rows_real_sent, rows_real_failed, duplicates_prevented",
      )
      .eq("worker_name", "scheduled-form-responses")
      .gte("started_at", since);
    const totals = (agg ?? []).reduce(
      (acc: Record<string, number>, r: any) => {
        for (const k of Object.keys(r)) acc[k] = (acc[k] ?? 0) + (r[k] ?? 0);
        return acc;
      },
      {
        rows_claimed: 0,
        rows_simulated_success: 0,
        rows_simulated_failed: 0,
        rows_skipped: 0,
        rows_real_sent: 0,
        rows_real_failed: 0,
        duplicates_prevented: 0,
      } as Record<string, number>,
    );

    const { data: pending } = await sb
      .from("scheduled_submission_responses")
      .select("id, scheduled_at, status, dry_run_validated_at, attempts")
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true })
      .limit(50);

    const { data: audit } = await sb
      .from("scheduler_mode_audit")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(10);

    return {
      settings: parsed,
      lastRuns: lastRuns ?? [],
      totals24h: totals,
      pending: pending ?? [],
      audit: audit ?? [],
    };
  });

const ModeInput = z.object({
  mode: z.enum(["dry_run", "real"]),
  reason: z.string().min(8, "Reason required (min 8 chars)").max(1000),
  confirm: z.literal("I UNDERSTAND THIS WILL SEND REAL MESSAGES").optional(),
});

export const setSchedulerMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ModeInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.mode === "real" && data.confirm !== "I UNDERSTAND THIS WILL SEND REAL MESSAGES") {
      throw new Error("Confirmation phrase required to enable real delivery");
    }
    const sb = await admin();
    const { data: current } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "forms_scheduled_delivery")
      .maybeSingle();
    const prev = parseSettings(current?.value);
    const next = {
      ...prev,
      mode: data.mode,
      // Switching back to dry_run also unsets the live kill switch — you must
      // re-arm it explicitly after enabling real mode again.
      live_enabled: data.mode === "real" ? prev.live_enabled : false,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      notes: data.reason,
    };
    await sb
      .from("app_settings")
      .upsert({ key: "forms_scheduled_delivery", value: settingsToValue(next) }, { onConflict: "key" });
    await sb.from("scheduler_mode_audit").insert({
      changed_by: context.userId,
      previous_mode: prev.mode,
      new_mode: data.mode,
      previous_emergency_disabled: prev.emergency_disable,
      new_emergency_disabled: prev.emergency_disable,
      reason: data.reason,
    });
    return { ok: true, settings: next };
  });

const EmergencyInput = z.object({
  disabled: z.boolean(),
  reason: z.string().min(4).max(1000),
});

export const setSchedulerEmergencyDisable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EmergencyInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { data: current } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "forms_scheduled_delivery")
      .maybeSingle();
    const prev = parseSettings(current?.value);
    const next = {
      ...prev,
      emergency_disable: data.disabled,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      notes: data.reason,
    };
    await sb
      .from("app_settings")
      .upsert({ key: "forms_scheduled_delivery", value: settingsToValue(next) }, { onConflict: "key" });
    await sb.from("scheduler_mode_audit").insert({
      changed_by: context.userId,
      previous_mode: prev.mode,
      new_mode: prev.mode,
      previous_emergency_disabled: prev.emergency_disable,
      new_emergency_disabled: data.disabled,
      reason: data.reason,
    });
    return { ok: true, settings: next };
  });

// Live kill switch — must be explicitly armed before any real delivery.
const LiveInput = z.object({
  enabled: z.boolean(),
  reason: z.string().min(4).max(1000),
  confirm: z.literal("I UNDERSTAND THIS WILL SEND REAL MESSAGES").optional(),
});

export const setSchedulerLiveEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LiveInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.enabled && data.confirm !== "I UNDERSTAND THIS WILL SEND REAL MESSAGES") {
      throw new Error("Confirmation phrase required to arm live delivery");
    }
    const sb = await admin();
    const { data: current } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "forms_scheduled_delivery")
      .maybeSingle();
    const prev = parseSettings(current?.value);
    const next = {
      ...prev,
      live_enabled: data.enabled,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      notes: data.reason,
    };
    await sb
      .from("app_settings")
      .upsert({ key: "forms_scheduled_delivery", value: settingsToValue(next) }, { onConflict: "key" });
    // Re-use the same audit table — log via reason text.
    await sb.from("scheduler_mode_audit").insert({
      changed_by: context.userId,
      previous_mode: prev.mode,
      new_mode: prev.mode,
      previous_emergency_disabled: prev.emergency_disable,
      new_emergency_disabled: prev.emergency_disable,
      reason: `live_enabled=${data.enabled} :: ${data.reason}`,
    });
    return { ok: true, settings: next };
  });

const AllowlistInput = z.object({
  clientIds: z.array(z.string().uuid()).max(50),
  reason: z.string().min(4).max(1000),
});

export const setSchedulerAllowlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AllowlistInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = await admin();
    const { data: current } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "forms_scheduled_delivery")
      .maybeSingle();
    const prev = parseSettings(current?.value);
    const next = {
      ...prev,
      allowed_test_recipients: data.clientIds,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      notes: data.reason,
    };
    await sb
      .from("app_settings")
      .upsert({ key: "forms_scheduled_delivery", value: settingsToValue(next) }, { onConflict: "key" });
    await sb.from("scheduler_mode_audit").insert({
      changed_by: context.userId,
      previous_mode: prev.mode,
      new_mode: prev.mode,
      previous_emergency_disabled: prev.emergency_disable,
      new_emergency_disabled: prev.emergency_disable,
      reason: `allowlist=${data.clientIds.length} :: ${data.reason}`,
    });
    return { ok: true, settings: next };
  });

/**
 * Admin-triggered manual tick — useful for QA without waiting for cron.
 * Calls the same server route as cron via fetch so it exercises the exact
 * same code path.
 */
export const runSchedulerNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const secret = process.env.SCHEDULED_WORKER_SECRET;
    if (!secret) {
      throw new Error(
        "SCHEDULED_WORKER_SECRET is not configured. Add the secret before running the worker.",
      );
    }
    // Same-origin fetch to the public hook
    const { getRequestHost } = await import("@tanstack/react-start/server");
    const host = (() => { try { return getRequestHost(); } catch { return null; } })();
    const base = host ? `https://${host}` : (process.env.SUPABASE_URL ?? "");
    const url = `${base.replace(/\/$/, "")}/api/public/hooks/scheduled-send-worker`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-worker-secret": secret },
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, result: body };
  });