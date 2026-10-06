/**
 * Wearable provider registry. Pure data, safe for client and server.
 *
 * `live` providers have a working adapter. Everything else renders as
 * "coming soon" so the UI never offers a button that does nothing.
 *
 * Integration path per provider (why it is not all one SDK):
 *  - oauth:        cloud API, we pull server-side after the athlete authorizes.
 *  - health_store: data lives on the phone (Apple Health / Health Connect). Needs a
 *                  native plugin in the app build that pushes samples to us.
 *                  Garmin, Apple Watch and most other devices sync into these.
 */
export type WearableProviderId =
  | "oura"
  | "whoop"
  | "garmin"
  | "fitbit"
  | "withings"
  | "polar"
  | "strava"
  | "apple_health"
  | "health_connect";

export type WearableProvider = {
  id: WearableProviderId;
  label: string;
  kind: "oauth" | "health_store";
  live: boolean;
  blurb: string;
};

export const WEARABLE_PROVIDERS: readonly WearableProvider[] = [
  {
    id: "oura",
    label: "Oura",
    kind: "oauth",
    live: true,
    blurb: "Sleep, readiness, HRV, resting HR, steps",
  },
  {
    id: "apple_health",
    label: "Apple Health",
    kind: "health_store",
    live: false,
    blurb: "Apple Watch, plus Garmin and others that sync to Health",
  },
  {
    id: "health_connect",
    label: "Health Connect",
    kind: "health_store",
    live: false,
    blurb: "Android: Garmin, Samsung, Fitbit, Oura and more",
  },
  { id: "whoop", label: "WHOOP", kind: "oauth", live: false, blurb: "Recovery, strain, sleep" },
  {
    id: "garmin",
    label: "Garmin",
    kind: "oauth",
    live: false,
    blurb: "Needs Garmin Health API approval",
  },
  { id: "fitbit", label: "Fitbit", kind: "oauth", live: false, blurb: "Sleep, steps, resting HR" },
  {
    id: "withings",
    label: "Withings",
    kind: "oauth",
    live: false,
    blurb: "Smart scale bodyweight and body comp",
  },
  { id: "polar", label: "Polar", kind: "oauth", live: false, blurb: "Sleep and recovery" },
  { id: "strava", label: "Strava", kind: "oauth", live: false, blurb: "Cardio activities" },
] as const;

export function getWearableProvider(id: string): WearableProvider | undefined {
  return WEARABLE_PROVIDERS.find((p) => p.id === id);
}

/**
 * Normalized one-day record. Every adapter maps into this shape; any field the
 * device does not report stays null (never 0), so averages are not poisoned.
 */
export type DailyMetric = {
  metric_date: string; // YYYY-MM-DD, athlete-local day as reported by the provider
  sleep_minutes: number | null;
  sleep_efficiency: number | null;
  sleep_score: number | null;
  readiness_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  temp_deviation_c: number | null;
  steps: number | null;
  active_kcal: number | null;
  activity_score: number | null;
};

export const METRIC_FIELDS = [
  "sleep_minutes",
  "sleep_efficiency",
  "sleep_score",
  "readiness_score",
  "hrv_ms",
  "resting_hr",
  "temp_deviation_c",
  "steps",
  "active_kcal",
  "activity_score",
] as const;

export type MetricField = (typeof METRIC_FIELDS)[number];

export function emptyMetric(metric_date: string): DailyMetric {
  return {
    metric_date,
    sleep_minutes: null,
    sleep_efficiency: null,
    sleep_score: null,
    readiness_score: null,
    hrv_ms: null,
    resting_hr: null,
    temp_deviation_c: null,
    steps: null,
    active_kcal: null,
    activity_score: null,
  };
}

/**
 * HRV is NOT one number. Oura, Whoop and Android Health Connect report RMSSD; Apple
 * Health reports SDNN. The two differ systematically (SDNN is usually larger and
 * behaves differently), so values and baselines must never be mixed across them.
 */
export type HrvMethod = "rmssd" | "sdnn";

const HRV_METHOD: Partial<Record<WearableProviderId, HrvMethod>> = {
  oura: "rmssd",
  whoop: "rmssd",
  health_connect: "rmssd",
  apple_health: "sdnn",
};

export function hrvMethodFor(provider: string): HrvMethod | null {
  return HRV_METHOD[provider as WearableProviderId] ?? null;
}

/**
 * Preference when several devices report recovery signals for the same days:
 * dedicated recovery wearables beat phone-health-store aggregates.
 */
export const RECOVERY_SOURCE_PRIORITY: readonly string[] = [
  "oura",
  "whoop",
  "garmin",
  "fitbit",
  "polar",
  "apple_health",
  "health_connect",
];
