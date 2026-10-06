/**
 * Native health-store bridge (Apple HealthKit on iOS, Health Connect on Android).
 *
 * The Capacitor plugin is INJECTED, not imported, so this file builds without the
 * native dependency. See docs/WEARABLES.md for the one-time wiring
 * (`bun add @capgo/capacitor-health` + the 3-line call site).
 *
 * Flow: request read access -> read the last N days -> normalize on-device ->
 * sanitize -> push to the server (ingestHealthStoreMetrics), which re-validates.
 */
import { getPlatform, isNative } from "./index";
import {
  normalizeHealthStore,
  type AggregatedBucket,
  type HealthSample,
} from "@/lib/wearables/health-store-normalize";
import { sanitizeMetrics } from "@/lib/wearables/ingest-schema";
import { ingestHealthStoreMetrics } from "@/lib/wearables/wearables.functions";

/** Minimal structural type of the plugin methods we use (matches @capgo/capacitor-health 8.x). */
export type HealthPluginLike = {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  requestAuthorization(o: { read: string[] }): Promise<unknown>;
  readSamples(o: {
    dataType: string;
    startDate: string;
    endDate: string;
    limit: number;
    ascending: boolean;
  }): Promise<{ samples: HealthSample[] }>;
  queryAggregated(o: {
    dataType: string;
    startDate: string;
    endDate: string;
    bucket: "day";
    aggregation: "sum";
  }): Promise<{ samples: AggregatedBucket[] }>;
};

/** Only what recovery analytics uses. Health Connect shows every requested type on its consent screen. */
export const HEALTH_READ_TYPES = [
  "steps",
  "calories",
  "sleep",
  "heartRateVariability",
  "restingHeartRate",
];

const SAMPLE_LIMIT = 5000; // the plugin default is 100, far too low for sleep stages

export function healthStoreProvider(): "apple_health" | "health_connect" | null {
  if (!isNative()) return null;
  const p = getPlatform();
  return p === "ios" ? "apple_health" : p === "android" ? "health_connect" : null;
}

export type HealthSyncResult =
  | { ok: true; days: number }
  | { ok: false; reason: "unavailable" | "no_data" | "error"; message?: string };

/**
 * `requestAccess: true` shows the OS permission sheet (do this from a user tap).
 * iOS never reveals whether READ access was granted, so "granted but empty" and
 * "denied" look identical: both come back as `no_data`.
 */
export async function syncHealthStore(
  plugin: HealthPluginLike,
  opts: { days?: number; requestAccess?: boolean } = {},
): Promise<HealthSyncResult> {
  const provider = healthStoreProvider();
  if (!provider) return { ok: false, reason: "unavailable" };
  try {
    const avail = await plugin.isAvailable();
    if (!avail.available) return { ok: false, reason: "unavailable", message: avail.reason };
    if (opts.requestAccess) await plugin.requestAuthorization({ read: HEALTH_READ_TYPES });

    const days = opts.days ?? 30; // Health Connect caps history at ~30 days without extra permission
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
    // Sleep needs a day of lead-in so a night that began before `start` is complete.
    const sleepStart = new Date(start.getTime() - 24 * 3600 * 1000);
    const range = (from: Date) => ({ startDate: from.toISOString(), endDate: end.toISOString() });
    // One denied/failed type must not sink the others.
    const safe = async <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const samples = (dataType: string, from: Date) =>
      safe(plugin.readSamples({ dataType, ...range(from), limit: SAMPLE_LIMIT, ascending: true }), {
        samples: [] as HealthSample[],
      });
    const daily = (dataType: string) =>
      safe(
        plugin.queryAggregated({ dataType, ...range(start), bucket: "day", aggregation: "sum" }),
        { samples: [] as AggregatedBucket[] },
      );

    const [steps, kcal, sleep, hrv, rhr] = await Promise.all([
      daily("steps"),
      daily("calories"),
      samples("sleep", sleepStart),
      samples("heartRateVariability", sleepStart),
      samples("restingHeartRate", start),
    ]);

    const rows = sanitizeMetrics(
      normalizeHealthStore({
        steps: steps.samples,
        activeKcal: kcal.samples,
        sleep: sleep.samples,
        hrv: hrv.samples,
        restingHr: rhr.samples,
      }) as unknown as Record<string, unknown>[],
    );
    if (!rows.length) return { ok: false, reason: "no_data" };

    const res = await ingestHealthStoreMetrics({ data: { provider, rows } });
    return { ok: true, days: res.days };
  } catch (e: any) {
    return { ok: false, reason: "error", message: e?.message };
  }
}
