/**
 * Native health-store bridge (Apple HealthKit on iOS, Health Connect on Android).
 *
 * The plugin JS ships in the web bundle, but the NATIVE half only exists in app builds
 * made with HealthKit / Health Connect enabled (see docs/WEARABLES.md). Older app
 * builds in people's hands do not have it, so always go through loadHealthPlugin().
 *
 * Flow: request read access -> read the last N days -> normalize on-device ->
 * sanitize -> push to the server (ingestHealthStoreMetrics), which re-validates.
 */
import { Capacitor } from "@capacitor/core";
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
    aggregation: "sum" | "min";
  }): Promise<{ samples: AggregatedBucket[] }>;
};

/** Only what recovery analytics uses. Health Connect shows every requested type on its consent screen. */
export const HEALTH_READ_TYPES = [
  "steps",
  "calories",
  "sleep",
  "heartRateVariability",
  "restingHeartRate",
  "heartRate", // fallback resting HR (daily minimum) for watches that don't write resting HR, e.g. Garmin on iPhone
];

const SAMPLE_LIMIT = 5000; // the plugin default is 100, far too low for sleep stages

export function healthStoreProvider(): "apple_health" | "health_connect" | null {
  if (!isNative()) return null;
  const p = getPlatform();
  return p === "ios" ? "apple_health" : p === "android" ? "health_connect" : null;
}

export type HealthSyncResult =
  | { ok: true; days: number }
  | { ok: false; reason: "unavailable" | "no_data" | "disconnected" | "error"; message?: string };

export type HealthPluginLoad =
  | { plugin: HealthPluginLike; reason: null }
  /** web: not in the phone app. needs_update: app build without the native health plugin. */
  | { plugin: null; reason: "web" | "needs_update" };

export async function loadHealthPlugin(): Promise<HealthPluginLoad> {
  if (!healthStoreProvider()) return { plugin: null, reason: "web" };
  if (!Capacitor.isPluginAvailable("Health")) return { plugin: null, reason: "needs_update" };
  const { Health } = await import("@capgo/capacitor-health");
  return { plugin: Health as unknown as HealthPluginLike, reason: null };
}

// Per-device convenience only ("this phone syncs health data"). The server connection
// row stays the source of truth; a disconnect anywhere stops background syncs here.
const DEVICE_FLAG = "jf-health-sync";
const AUTO_SYNC_EVERY_MS = 3 * 3600 * 1000;

function readFlag(): { provider: string; lastSync: number } | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_FLAG);
    return raw ? (JSON.parse(raw) as { provider: string; lastSync: number }) : null;
  } catch {
    return null;
  }
}
function writeFlag(v: { provider: string; lastSync: number } | null) {
  try {
    if (v) window.localStorage.setItem(DEVICE_FLAG, JSON.stringify(v));
    else window.localStorage.removeItem(DEVICE_FLAG);
  } catch {
    /* storage unavailable: background sync just won't run */
  }
}
export const clearHealthDeviceSync = () => writeFlag(null);

/** Called when the app returns to the foreground. Quietly tops up the last week. */
export async function autoSyncHealthStore(): Promise<void> {
  const flag = readFlag();
  if (!flag || Date.now() - flag.lastSync < AUTO_SYNC_EVERY_MS) return;
  const { plugin } = await loadHealthPlugin();
  if (!plugin) return;
  await syncHealthStore(plugin, { days: 7 });
}

/**
 * `requestAccess: true` shows the OS permission sheet (do this from a user tap).
 * iOS never reveals whether READ access was granted, so "granted but empty" and
 * "denied" look identical: both come back as `no_data`.
 */
export async function syncHealthStore(
  plugin: HealthPluginLike,
  opts: { days?: number; requestAccess?: boolean } = {},
  // requestAccess doubles as "the athlete tapped Connect": only that may re-enable a
  // connection they disconnected. Background syncs never do.
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
    const daily = (dataType: string, aggregation: "sum" | "min" = "sum") =>
      safe(plugin.queryAggregated({ dataType, ...range(start), bucket: "day", aggregation }), {
        samples: [] as AggregatedBucket[],
      });

    const [steps, kcal, sleep, hrv, rhr, minHr] = await Promise.all([
      daily("steps"),
      daily("calories"),
      samples("sleep", sleepStart),
      samples("heartRateVariability", sleepStart),
      samples("restingHeartRate", start),
      daily("heartRate", "min"),
    ]);

    const rows = sanitizeMetrics(
      normalizeHealthStore({
        steps: steps.samples,
        activeKcal: kcal.samples,
        sleep: sleep.samples,
        hrv: hrv.samples,
        restingHr: rhr.samples,
        minHeartRate: minHr.samples,
      }) as unknown as Record<string, unknown>[],
    );
    if (!rows.length) return { ok: false, reason: "no_data" };

    const res = await ingestHealthStoreMetrics({
      data: { provider, rows, reconnect: !!opts.requestAccess },
    });
    if (!res.ok) {
      writeFlag(null); // disconnected elsewhere: stop background syncs on this phone
      return { ok: false, reason: "disconnected" };
    }
    writeFlag({ provider, lastSync: Date.now() });
    return { ok: true, days: res.days };
  } catch (e: any) {
    return { ok: false, reason: "error", message: e?.message };
  }
}
