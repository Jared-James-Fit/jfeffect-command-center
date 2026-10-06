import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, resolvePovClientId, resolvePovUserId } from "@/lib/client-pov.server";
import { getWearableProvider } from "./providers";
import { IngestInput } from "./ingest-schema";
import type { TrainingDay } from "./load-analytics";

const MANUAL_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const ProviderInput = z.object({ provider: z.string().min(1).max(32) });

function assertLiveOauth(provider: string) {
  const p = getWearableProvider(provider);
  if (!p || !p.live || p.kind !== "oauth") throw new Error("That device is not available yet.");
  return p;
}

/** Connections + recent daily metrics. Works for the athlete and, via RLS, for their coach (View as client). */
export const getWearableOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    PovInput.extend({ days: z.number().int().min(7).max(120).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const targetId = await resolvePovUserId(supabase, userId, data);
    const days = data.days ?? 45;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const [{ data: connections }, { data: metrics }] = await Promise.all([
      supabase
        .from("wearable_connections")
        .select("provider, status, shared_with_coach, last_synced_at, last_error")
        .eq("user_id", targetId),
      supabase
        .from("wearable_daily_metrics")
        .select(
          "provider, metric_date, sleep_minutes, sleep_efficiency, sleep_score, readiness_score, hrv_ms, resting_hr, temp_deviation_c, steps, active_kcal, activity_score",
        )
        .eq("user_id", targetId)
        .gte("metric_date", since)
        .order("metric_date", { ascending: true }),
    ]);

    const { ouraConfigured } = await import("./oura.server");
    return {
      isOwner: targetId === userId,
      configured: { oura: ouraConfigured() },
      connections: (connections ?? []) as {
        provider: string;
        status: string;
        shared_with_coach: boolean;
        last_synced_at: string | null;
        last_error: string | null;
      }[],
      metrics: (metrics ?? []) as any[],
    };
  });

/** Starts the provider OAuth flow for the signed-in athlete. Returns the URL to open. */
export const beginWearableConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProviderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    assertLiveOauth(data.provider);
    const { ouraConfigured, signWearableState, buildOuraAuthorizeUrl } =
      await import("./oura.server");
    if (!ouraConfigured()) throw new Error("Oura is not configured yet. Ask your coach.");
    const origin = new URL(getRequest().url).origin;
    const state = signWearableState({ user_id: userId, provider: data.provider });
    return { url: buildOuraAuthorizeUrl(origin, state) };
  });

/** Disconnect, drop tokens, and optionally erase every stored metric from this device. */
export const disconnectWearable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ProviderInput.extend({ deleteData: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin: typedAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = typedAdmin as any; // generated types predate the wearable tables
    const { data: conn } = await supabaseAdmin
      .from("wearable_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (!conn) return { ok: true };
    await supabaseAdmin.from("wearable_connection_secrets").delete().eq("connection_id", conn.id);
    await supabaseAdmin
      .from("wearable_connections")
      .update({ status: "disconnected", sync_started_at: null, last_error: null })
      .eq("id", conn.id);
    if (data.deleteData) {
      await supabaseAdmin
        .from("wearable_daily_metrics")
        .delete()
        .eq("user_id", userId)
        .eq("provider", data.provider);
    }
    return { ok: true };
  });

export const syncWearableNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProviderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: conn } = await supabase
      .from("wearable_connections")
      .select("id, status, last_synced_at")
      .eq("user_id", userId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (!conn || conn.status !== "connected") throw new Error("Device is not connected.");
    if (
      conn.last_synced_at &&
      Date.now() - new Date(conn.last_synced_at).getTime() < MANUAL_SYNC_COOLDOWN_MS
    ) {
      return { ok: true, days: 0, skipped: "recent" as const };
    }
    const { syncConnection } = await import("./sync.server");
    const r = await syncConnection(conn.id);
    if (!r.ok && r.error) throw new Error(r.error);
    return { ok: true, days: r.days };
  });

export const setWearableSharing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProviderInput.extend({ shared: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    // Column-level grant + owner RLS: this can only ever touch the caller's own row.
    const { error } = await supabase
      .from("wearable_connections")
      .update({ shared_with_coach: data.shared })
      .eq("user_id", userId)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Called by the native app after the athlete grants Apple Health / Health Connect access.
 * The phone sends already-normalized daily rows; we validate, merge and store them under
 * the caller's own user id (never one supplied by the client).
 */
export const ingestHealthStoreMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => IngestInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin: typedAdmin } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = typedAdmin as any; // generated types predate the wearable tables
    const { data: conn, error } = await supabaseAdmin
      .from("wearable_connections")
      .upsert(
        // Re-granting access reconnects; the sharing flag is deliberately not touched here.
        { user_id: userId, provider: data.provider, status: "connected", last_error: null },
        { onConflict: "user_id,provider" },
      )
      .select("id")
      .single();
    if (error || !conn) throw new Error("Couldn't register the device.");
    const { saveDailyMetrics } = await import("./sync.server");
    await saveDailyMetrics(supabaseAdmin, userId, data.provider, data.rows);
    await supabaseAdmin
      .from("wearable_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", conn.id);
    return { ok: true, days: data.rows.length };
  });

/** Daily hard sets / tonnage for the athlete (or the client a coach is viewing). Gated in SQL. */
export const getTrainingLoadDays = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    PovInput.extend({ days: z.number().int().min(14).max(180).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const clientId = await resolvePovClientId(supabase, userId, data);
    if (!clientId) return { days: [] as TrainingDay[] };
    const { data: rows, error } = await supabase.rpc("client_daily_training_load", {
      _client_id: clientId,
      _days: data.days ?? 90,
    });
    if (error) throw new Error(error.message);
    return {
      days: ((rows ?? []) as any[]).map((r): TrainingDay => ({
        day: String(r.day),
        sets: Number(r.sets) || 0,
        hard_sets: Number(r.hard_sets) || 0,
        tonnage_kg: Number(r.tonnage_kg) || 0,
        avg_rpe: r.avg_rpe == null ? null : Number(r.avg_rpe),
      })),
    };
  });
