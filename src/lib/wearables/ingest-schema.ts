/**
 * Validation for metrics PUSHED from the phone's health store (Apple Health,
 * Health Connect). The client is untrusted: bounds mirror the table CHECKs, dates
 * can't be in the future, and the batch is capped.
 */
import { z } from "zod";

export const HEALTH_STORE_PROVIDERS = ["apple_health", "health_connect"] as const;
export const MAX_INGEST_DAYS = 120;

const nullInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
const nullNum = (min: number, max: number) => z.number().min(min).max(max).nullable();

const tomorrowISO = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

const DATE_SCHEMA = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => d >= "2015-01-01" && d <= tomorrowISO(), "date out of range");

const FIELD_SCHEMAS = {
  sleep_minutes: nullInt(0, 1440),
  sleep_efficiency: nullInt(0, 100),
  sleep_score: nullInt(0, 100),
  readiness_score: nullInt(0, 100),
  hrv_ms: nullNum(1, 500),
  resting_hr: nullNum(20, 250),
  temp_deviation_c: nullNum(-10, 10),
  steps: nullInt(0, 200000),
  active_kcal: nullInt(0, 20000),
  activity_score: nullInt(0, 100),
};

export const DailyMetricInput = z.object({
  metric_date: DATE_SCHEMA,
  ...FIELD_SCHEMAS,
});

export const IngestInput = z.object({
  provider: z.enum(HEALTH_STORE_PROVIDERS),
  rows: z
    .array(DailyMetricInput)
    .min(1)
    .max(MAX_INGEST_DAYS)
    .refine(
      (rows) => new Set(rows.map((r) => r.metric_date)).size === rows.length,
      "duplicate dates",
    ),
});

/**
 * Client-side: keep every valid value and null the rest, so one odd reading (a sensor
 * glitch, a unit surprise) costs a field, not the whole batch the server would reject.
 * Rows with a bad date or nothing valid are dropped.
 */
export function sanitizeMetrics(
  rows: Record<string, unknown>[],
): z.infer<typeof DailyMetricInput>[] {
  const out: z.infer<typeof DailyMetricInput>[] = [];
  for (const row of rows) {
    const date = DATE_SCHEMA.safeParse(row.metric_date);
    if (!date.success) continue;
    const clean: Record<string, unknown> = { metric_date: date.data };
    let any = false;
    for (const [field, schema] of Object.entries(FIELD_SCHEMAS)) {
      const r = schema.safeParse(row[field] ?? null);
      clean[field] = r.success ? r.data : null;
      if (clean[field] != null) any = true;
    }
    if (any) out.push(clean as z.infer<typeof DailyMetricInput>);
  }
  return out.slice(-MAX_INGEST_DAYS);
}
