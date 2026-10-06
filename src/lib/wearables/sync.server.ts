// Server-only: pull a connection's data and write normalized daily metrics.
// Uses the service role (tokens + metric writes are never reachable from the client).

import { METRIC_FIELDS, type DailyMetric } from "./providers";
import { fetchOuraCollections, refreshOuraToken } from "./oura.server";
import { normalizeOura } from "./oura-normalize";

const FIRST_SYNC_DAYS = 30;
const OVERLAP_DAYS = 3; // providers revise recent days; always re-pull a little
const LOCK_MS = 5 * 60 * 1000;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Window to pull. Pure so it can be tested. */
export function syncWindow(
  lastSyncedAt: string | null,
  now = new Date(),
): { start: string; end: string } {
  const end = new Date(now.getTime() + 24 * 3600 * 1000); // provider "today" may be ahead of UTC
  const startBase = lastSyncedAt
    ? new Date(new Date(lastSyncedAt).getTime() - OVERLAP_DAYS * 24 * 3600 * 1000)
    : new Date(now.getTime() - FIRST_SYNC_DAYS * 24 * 3600 * 1000);
  return { start: iso(startBase), end: iso(end) };
}

/** New non-null values win; a null from the provider never erases a value we already have. */
export function mergeMetric(
  existing: Partial<DailyMetric> | undefined,
  incoming: DailyMetric,
): DailyMetric {
  const out: any = { metric_date: incoming.metric_date };
  for (const f of METRIC_FIELDS) out[f] = incoming[f] ?? (existing as any)?.[f] ?? null;
  return out as DailyMetric;
}

/**
 * Merge-and-upsert normalized days for one athlete+provider. Shared by cloud pulls
 * (Oura) and device pushes (Apple Health / Health Connect). Idempotent per day.
 */
export async function saveDailyMetrics(
  admin: any,
  userId: string,
  provider: string,
  rows: DailyMetric[],
): Promise<void> {
  if (!rows.length) return;
  const dates = rows.map((r) => r.metric_date).sort();
  const { data: existing } = await admin
    .from("wearable_daily_metrics")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .gte("metric_date", dates[0])
    .lte("metric_date", dates[dates.length - 1]);
  const prior = new Map<string, any>(
    (existing ?? []).map((r: any) => [r.metric_date as string, r]),
  );
  const payload = rows.map((r) => ({
    ...mergeMetric(prior.get(r.metric_date), r),
    user_id: userId,
    provider,
  }));
  const { error } = await admin
    .from("wearable_daily_metrics")
    .upsert(payload, { onConflict: "user_id,provider,metric_date" });
  if (error) throw new Error(`Saving metrics failed: ${error.message}`);
}

export type SyncResult = {
  ok: boolean;
  days: number;
  skipped?: "locked" | "not_connected";
  error?: string;
};

export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const { supabaseAdmin: typedAdmin } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = typedAdmin as any; // generated types predate the wearable tables

  // Claim the sync. Oura refresh tokens are single-use, so two concurrent syncs would
  // burn the token and force the athlete to reconnect.
  const lockCutoff = new Date(Date.now() - LOCK_MS).toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("wearable_connections")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("id", connectionId)
    .eq("status", "connected")
    .or(`sync_started_at.is.null,sync_started_at.lt.${lockCutoff}`)
    .select("id, user_id, provider, last_synced_at")
    .maybeSingle();
  if (!claimed) return { ok: false, days: 0, skipped: "locked" };

  const release = (patch: Record<string, unknown>) =>
    supabaseAdmin
      .from("wearable_connections")
      .update({ sync_started_at: null, ...patch })
      .eq("id", connectionId);

  try {
    if (claimed.provider !== "oura") throw new Error(`No sync adapter for ${claimed.provider}.`);

    const { data: secret } = await supabaseAdmin
      .from("wearable_connection_secrets")
      .select("access_token, refresh_token, token_expires_at")
      .eq("connection_id", connectionId)
      .maybeSingle();
    if (!secret?.refresh_token && !secret?.access_token) {
      await release({ status: "reconnect_required", last_error: "Missing credentials." });
      return { ok: false, days: 0, skipped: "not_connected" };
    }

    let token = secret.access_token as string | null;
    const expired =
      !secret.token_expires_at || new Date(secret.token_expires_at).getTime() < Date.now() + 60_000;
    if (!token || expired) {
      if (!secret.refresh_token)
        throw Object.assign(new Error("No refresh token."), { reauth: true });
      const t = await refreshOuraToken(secret.refresh_token);
      token = t.access_token;
      // Persist the rotated refresh token immediately, before any other work.
      await supabaseAdmin.from("wearable_connection_secrets").upsert({
        connection_id: connectionId,
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? secret.refresh_token,
        token_expires_at: new Date(Date.now() + (t.expires_in - 30) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const { start, end } = syncWindow(claimed.last_synced_at);
    const rows = normalizeOura(await fetchOuraCollections(token!, start, end));

    await saveDailyMetrics(supabaseAdmin, claimed.user_id, claimed.provider, rows);

    await release({ last_synced_at: new Date().toISOString(), last_error: null });
    return { ok: true, days: rows.length };
  } catch (e: any) {
    const reauth = !!e?.reauth;
    await release({
      ...(reauth ? { status: "reconnect_required" } : {}),
      last_error: String(e?.message ?? e).slice(0, 300),
    });
    return { ok: false, days: 0, error: e?.message ?? "sync_failed" };
  }
}
