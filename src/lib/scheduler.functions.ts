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
  updated_at: string | null;
  updated_by: string | null;
  notes: string | null;
} {
  let v: any = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { v = {}; }
  }
  return {
    mode: v?.mode === "real" ? "real" : "dry_run",
    emergency_disable: !!v?.emergency_disable,
    updated_at: v?.updated_at ?? null,
    updated_by: v?.updated_by ?? null,
    notes: v?.notes ?? null,
  };
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
      mode: data.mode,
      emergency_disable: prev.emergency_disable,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      notes: data.reason,
    };
    await sb
      .from("app_settings")
      .upsert({ key: "forms_scheduled_delivery", value: JSON.stringify(next) }, { onConflict: "key" });
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
      mode: prev.mode,
      emergency_disable: data.disabled,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
      notes: data.reason,
    };
    await sb
      .from("app_settings")
      .upsert({ key: "forms_scheduled_delivery", value: JSON.stringify(next) }, { onConflict: "key" });
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

/**
 * Admin-triggered manual tick — useful for QA without waiting for cron.
 * Calls the same server route as cron via fetch so it exercises the exact
 * same code path.
 */
export const runSchedulerNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    // Same-origin fetch to the public hook
    const { getRequestHost } = await import("@tanstack/react-start/server");
    const host = (() => { try { return getRequestHost(); } catch { return null; } })();
    const base = host ? `https://${host}` : (process.env.SUPABASE_URL ?? "");
    const url = `${base.replace(/\/$/, "")}/api/public/hooks/scheduled-send-worker`;
    const r = await fetch(url, { method: "POST" });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, result: body };
  });