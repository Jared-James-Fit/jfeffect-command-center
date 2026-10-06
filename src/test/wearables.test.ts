import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOura } from "@/lib/wearables/oura-normalize";
import {
  baseline,
  resolveDaily,
  summarizeRecovery,
  trailingAverage,
} from "@/lib/wearables/analytics";
import { mergeMetric, syncWindow } from "@/lib/wearables/sync.server";
import { emptyMetric, type DailyMetric } from "@/lib/wearables/providers";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const series = (n: number, f: (i: number) => Partial<DailyMetric>): DailyMetric[] =>
  Array.from({ length: n }, (_, i) => ({ ...emptyMetric(day(i)), ...f(i) }));

describe("normalizeOura", () => {
  it("merges the four collections per day and uses the longest long_sleep, not naps", () => {
    const out = normalizeOura({
      daily_sleep: [{ day: "2026-10-01", score: 81 }],
      daily_readiness: [{ day: "2026-10-01", score: 74, temperature_deviation: 0.123 }],
      daily_activity: [{ day: "2026-10-01", steps: 9120, active_calories: 540.4, score: 70 }],
      sleep: [
        {
          day: "2026-10-01",
          type: "long_sleep",
          total_sleep_duration: 27000,
          efficiency: 91,
          average_hrv: 62.34,
          lowest_heart_rate: 48,
        },
        {
          day: "2026-10-01",
          type: "long_sleep",
          total_sleep_duration: 3600,
          efficiency: 70,
          average_hrv: 20,
          lowest_heart_rate: 70,
        },
        {
          day: "2026-10-01",
          type: "late_nap",
          total_sleep_duration: 1800,
          average_hrv: 10,
          lowest_heart_rate: 90,
        },
      ],
    });
    expect(out).toEqual([
      {
        metric_date: "2026-10-01",
        sleep_minutes: 450,
        sleep_efficiency: 91,
        sleep_score: 81,
        readiness_score: 74,
        hrv_ms: 62.3,
        resting_hr: 48,
        temp_deviation_c: 0.12,
        steps: 9120,
        active_kcal: 540,
        activity_score: 70,
      },
    ]);
  });

  it("leaves missing values null (never 0) and ignores malformed days", () => {
    const out = normalizeOura({
      daily_sleep: [{ day: "bad", score: 50 }],
      daily_readiness: [],
      daily_activity: [],
      sleep: [{ day: "2026-10-02", type: "long_sleep", total_sleep_duration: 0, average_hrv: 0 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].sleep_minutes).toBeNull();
    expect(out[0].hrv_ms).toBeNull();
  });
});

describe("sync helpers", () => {
  it("backfills 30 days first, then re-pulls a 3-day overlap", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(syncWindow(null, now).start).toBe("2026-09-06");
    expect(syncWindow("2026-10-05T12:00:00Z", now).start).toBe("2026-10-02");
  });

  it("never lets a provider null erase an existing value", () => {
    const merged = mergeMetric({ steps: 5000, hrv_ms: 55 } as any, {
      ...emptyMetric("2026-10-06"),
      steps: 8000,
    });
    expect(merged.steps).toBe(8000);
    expect(merged.hrv_ms).toBe(55);
  });
});

describe("analytics", () => {
  it("resolveDaily prefers higher-priority providers per field and falls back per field", () => {
    const out = resolveDaily(
      [
        { ...emptyMetric("2026-10-01"), provider: "apple_health", hrv_ms: 40, steps: 7000 },
        { ...emptyMetric("2026-10-01"), provider: "oura", hrv_ms: 60 },
      ],
      ["oura", "apple_health"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].hrv_ms).toBe(60);
    expect(out[0].steps).toBe(7000);
  });

  it("baseline needs enough prior data and excludes the day itself", () => {
    const s = series(10, () => ({ hrv_ms: 50 }));
    expect(baseline(s, "hrv_ms", day(3))).toBeNull();
    expect(baseline(s, "hrv_ms", day(9))).toBe(50);
  });

  it("flags a real HRV + resting HR drop as low, relative to the athlete's own baseline", () => {
    const s = series(15, (i) =>
      i < 14
        ? { hrv_ms: 80, resting_hr: 50, sleep_minutes: 450 }
        : { hrv_ms: 56, resting_hr: 59, sleep_minutes: 450 },
    );
    const r = summarizeRecovery(s)!;
    expect(r.state).toBe("low");
    expect(r.reasons).toHaveLength(2);
  });

  it("does not flag a normal day, and one weak signal is only 'watch'", () => {
    const ok = series(15, () => ({ hrv_ms: 45, resting_hr: 55, sleep_minutes: 440 }));
    expect(summarizeRecovery(ok)!.state).toBe("good");
    const weak = series(15, (i) =>
      i < 14 ? { hrv_ms: 100, resting_hr: 50 } : { hrv_ms: 82, resting_hr: 51 },
    );
    expect(summarizeRecovery(weak)!.state).toBe("watch");
  });

  it("reports unknown with no baseline instead of guessing", () => {
    expect(summarizeRecovery(series(3, () => ({ hrv_ms: 50 })))!.state).toBe("unknown");
    expect(summarizeRecovery([])).toBeNull();
  });

  it("trailingAverage ignores nulls", () => {
    expect(
      trailingAverage(
        series(7, (i) => ({ steps: i % 2 ? 1000 : null })),
        "steps",
        7,
      ),
    ).toBe(1000);
  });
});

describe("wearables security contract", () => {
  const migration = read("supabase/migrations/20261006090000_wearables_foundation.sql");

  it("keeps tokens unreachable from client roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON public.wearable_connection_secrets FROM anon, authenticated",
    );
    expect(migration).not.toMatch(/GRANT[^;]*wearable_connection_secrets TO authenticated/);
  });

  it("gives clients read-only metrics and only the sharing column on connections", () => {
    expect(migration).toContain("GRANT SELECT ON public.wearable_daily_metrics TO authenticated");
    expect(migration).toContain(
      "GRANT UPDATE (shared_with_coach) ON public.wearable_connections TO authenticated",
    );
    expect(migration).not.toMatch(/GRANT[^;]*(INSERT|DELETE)[^;]*wearable_/);
  });

  it("honours the athlete's coach-sharing choice and the real coach assignment helper", () => {
    expect(migration).toContain("shared_with_coach");
    expect(migration).toContain("public.is_assigned_coach(c.id)");
  });

  it("never awards level points from wearable data (XP is trigger-only, AGENTS.md)", () => {
    expect(migration).not.toContain("athlete_xp_events");
    for (const f of ["sync.server.ts", "wearables.functions.ts", "oura.server.ts"]) {
      expect(read(`src/lib/wearables/${f}`)).not.toContain("athlete_xp_events");
    }
  });
});

describe("health-store ingest validation", () => {
  const row = { ...emptyMetric("2026-10-05"), steps: 8000, hrv_ms: 55 };

  it("accepts a normal batch", async () => {
    const { IngestInput } = await import("@/lib/wearables/ingest-schema");
    expect(IngestInput.safeParse({ provider: "apple_health", rows: [row] }).success).toBe(true);
  });

  it("rejects out-of-range values, future dates, duplicate days and oversize batches", async () => {
    const { IngestInput } = await import("@/lib/wearables/ingest-schema");
    const bad = (rows: unknown[], provider = "apple_health") =>
      IngestInput.safeParse({ provider, rows }).success;
    expect(bad([{ ...row, steps: -1 }])).toBe(false);
    expect(bad([{ ...row, resting_hr: 400 }])).toBe(false);
    expect(bad([{ ...row, metric_date: "2999-01-01" }])).toBe(false);
    expect(bad([row, row])).toBe(false);
    expect(bad([row], "oura")).toBe(false); // cloud providers cannot be pushed from the client
    expect(bad(Array.from({ length: 121 }, (_, i) => ({ ...row, metric_date: day(i - 60) })))).toBe(
      false,
    );
  });

  it("derives the user from the session, never from client input", () => {
    const src = read("src/lib/wearables/wearables.functions.ts");
    const fn = src.slice(src.indexOf("ingestHealthStoreMetrics"));
    expect(fn).toContain("const { userId } = context");
    expect(fn).not.toMatch(/data\.user_?[iI]d/);
  });
});
