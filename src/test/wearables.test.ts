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
  const migration = read("supabase/migrations/20261006140000_wearables_foundation.sql");

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

describe("recovery source selection (no cross-device HRV mixing)", () => {
  const stored = (provider: string, i: number, f: Partial<DailyMetric>) => ({
    ...emptyMetric(day(i)),
    ...f,
    provider,
  });

  it("labels HRV by method: Apple is SDNN, Oura/Health Connect are RMSSD", async () => {
    const { hrvMethodFor } = await import("@/lib/wearables/providers");
    expect(hrvMethodFor("apple_health")).toBe("sdnn");
    expect(hrvMethodFor("oura")).toBe("rmssd");
    expect(hrvMethodFor("health_connect")).toBe("rmssd");
    expect(hrvMethodFor("strava")).toBeNull();
  });

  it("does not flag a false HRV drop when an athlete switches from Oura (RMSSD) to Apple Watch (SDNN)", async () => {
    const { summarizeRecoveryFromRows } = await import("@/lib/wearables/analytics");
    // 14 days of Oura at ~80 ms RMSSD, then Oura stops and Apple reports ~40 ms SDNN.
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => stored("oura", i, { hrv_ms: 80 })),
      ...Array.from({ length: 4 }, (_, i) => stored("apple_health", 14 + i, { hrv_ms: 40 })),
    ];
    const r = summarizeRecoveryFromRows(rows)!;
    // Apple is the only current source now; its own baseline is too short -> not "low".
    expect(r.summary.provider).toBe("apple_health");
    expect(r.summary.state).toBe("unknown");
    expect(r.summary.hrvMethod).toBe("sdnn");
    expect(r.series.every((d) => d.hrv_ms === 40)).toBe(true);
  });

  it("prefers the ring over the phone when both are current, and survives one late sync", async () => {
    const { pickRecoverySource } = await import("@/lib/wearables/analytics");
    const both = [
      ...Array.from({ length: 10 }, (_, i) => stored("apple_health", i, { hrv_ms: 40 })),
      ...Array.from({ length: 9 }, (_, i) => stored("oura", i, { hrv_ms: 80 })), // Oura 1 day behind
    ];
    expect(pickRecoverySource(both)?.provider).toBe("oura");
    const ouraStale = [
      ...Array.from({ length: 10 }, (_, i) => stored("apple_health", i, { hrv_ms: 40 })),
      ...Array.from({ length: 4 }, (_, i) => stored("oura", i, { hrv_ms: 80 })), // 6 days behind
    ];
    expect(pickRecoverySource(ouraStale)?.provider).toBe("apple_health");
    expect(pickRecoverySource([])).toBeNull();
    expect(pickRecoverySource([stored("oura", 0, { steps: 5000 })])).toBeNull();
  });

  it("still flags a genuine drop within a single source", async () => {
    const { summarizeRecoveryFromRows } = await import("@/lib/wearables/analytics");
    const rows = Array.from({ length: 15 }, (_, i) =>
      stored("oura", i, i < 14 ? { hrv_ms: 80, resting_hr: 50 } : { hrv_ms: 56, resting_hr: 59 }),
    );
    expect(summarizeRecoveryFromRows(rows)!.summary.state).toBe("low");
  });
});

describe("health-store normalization (phone -> DailyMetric)", () => {
  const utcDate = (iso: string) => iso.slice(0, 10);
  const seg = (start: string, end: string, state = "asleep", sourceName = "Watch") => ({
    value: 0,
    startDate: start,
    endDate: end,
    sleepState: state,
    sourceName,
  });

  it("attributes a night to its wake-up date, counts only asleep stages, and averages overnight HRV", async () => {
    const { normalizeHealthStore } = await import("@/lib/wearables/health-store-normalize");
    const out = normalizeHealthStore(
      {
        sleep: [
          seg("2026-10-04T22:00:00Z", "2026-10-05T06:00:00Z", "inBed"),
          seg("2026-10-04T22:30:00Z", "2026-10-05T02:30:00Z", "light"),
          seg("2026-10-05T02:30:00Z", "2026-10-05T03:00:00Z", "awake"),
          seg("2026-10-05T03:00:00Z", "2026-10-05T06:00:00Z", "deep"),
        ],
        hrv: [
          { value: 50, startDate: "2026-10-05T01:00:00Z", endDate: "2026-10-05T01:00:00Z" },
          { value: 70, startDate: "2026-10-05T04:00:00Z", endDate: "2026-10-05T04:00:00Z" },
          { value: 20, startDate: "2026-10-05T15:00:00Z", endDate: "2026-10-05T15:00:00Z" }, // daytime: ignored
        ],
        restingHr: [
          { value: 52, startDate: "2026-10-05T08:00:00Z", endDate: "2026-10-05T08:00:00Z" },
          { value: 54, startDate: "2026-10-05T20:00:00Z", endDate: "2026-10-05T20:00:00Z" },
        ],
        steps: [{ startDate: "2026-10-05T00:00:00Z", value: 9000.4 }],
        activeKcal: [{ startDate: "2026-10-05T00:00:00Z", value: 0 }],
      },
      utcDate,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      metric_date: "2026-10-05",
      sleep_minutes: 420, // 4h light + 3h deep, awake and inBed excluded
      hrv_ms: 60,
      resting_hr: 54, // latest of the day
      steps: 9000,
      active_kcal: null, // 0 is "no data", never a value
    });
  });

  it("does not double count two sources writing the same night, and ignores naps", async () => {
    const { normalizeHealthStore } = await import("@/lib/wearables/health-store-normalize");
    const out = normalizeHealthStore(
      {
        sleep: [
          seg("2026-10-04T23:00:00Z", "2026-10-05T06:00:00Z", "asleep", "Watch"),
          seg("2026-10-04T23:00:00Z", "2026-10-05T06:00:00Z", "asleep", "iPhone"),
          seg("2026-10-05T14:00:00Z", "2026-10-05T14:40:00Z", "asleep", "Watch"), // nap
        ],
      },
      utcDate,
    );
    expect(out).toHaveLength(1);
    expect(out[0].sleep_minutes).toBe(420);
  });

  it("expands Android-style sessions with stages and merges brief wake gaps", async () => {
    const { normalizeHealthStore } = await import("@/lib/wearables/health-store-normalize");
    const out = normalizeHealthStore(
      {
        sleep: [
          {
            value: 0,
            startDate: "2026-10-04T23:00:00Z",
            endDate: "2026-10-05T07:00:00Z",
            sourceName: "Health Connect",
            stages: [
              {
                startDate: "2026-10-04T23:00:00Z",
                endDate: "2026-10-05T03:00:00Z",
                stage: "light",
              },
              {
                startDate: "2026-10-05T03:00:00Z",
                endDate: "2026-10-05T03:20:00Z",
                stage: "awake",
              },
              { startDate: "2026-10-05T03:20:00Z", endDate: "2026-10-05T07:00:00Z", stage: "rem" },
            ],
          },
        ],
      },
      utcDate,
    );
    expect(out[0].sleep_minutes).toBe(460); // 240 + 220
  });

  it("returns nothing for days with no usable data", async () => {
    const { normalizeHealthStore } = await import("@/lib/wearables/health-store-normalize");
    expect(
      normalizeHealthStore({ steps: [{ startDate: "2026-10-05T00:00:00Z", value: 0 }] }, utcDate),
    ).toEqual([]);
  });

  it("sanitizeMetrics keeps valid values, nulls glitches, drops empty/invalid rows", async () => {
    const { sanitizeMetrics } = await import("@/lib/wearables/ingest-schema");
    const out = sanitizeMetrics([
      { ...emptyMetric("2026-10-05"), steps: 8000, resting_hr: 900 }, // glitch nulled, steps kept
      { ...emptyMetric("2026-10-04"), steps: -5 }, // nothing valid -> dropped
      { ...emptyMetric("not-a-date"), steps: 100 }, // bad date -> dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].steps).toBe(8000);
    expect(out[0].resting_hr).toBeNull();
  });
});

describe("training load vs recovery", () => {
  const td = (
    i: number,
    hard: number,
    sets = hard + 2,
  ): import("@/lib/wearables/load-analytics").TrainingDay => ({
    day: day(i),
    sets,
    hard_sets: hard,
    tonnage_kg: sets * 500,
    avg_rpe: 8,
  });

  it("loadRamp flags a spike against the 28-day average and stays unknown with thin history", async () => {
    const { loadRamp } = await import("@/lib/wearables/load-analytics");
    // 3 steady weeks at 8 hard sets/week, then a 24-set week.
    const days = [
      ...[0, 7, 14].flatMap((w) => [td(w, 4), td(w + 3, 4)]),
      td(21, 8),
      td(23, 8),
      td(25, 8),
    ];
    const r = loadRamp(days, day(27))!;
    expect(r.acuteHardSets).toBe(24);
    expect(r.state).toBe("ramping");
    expect(r.ratio).toBeGreaterThan(1.5);
    expect(loadRamp([td(0, 5), td(2, 5)], day(5))!.state).toBe("unknown");
    expect(loadRamp([], day(5))).toBeNull();
  });

  it("loadRamp reads steady for a flat block", async () => {
    const { loadRamp } = await import("@/lib/wearables/load-analytics");
    const days = [0, 7, 14, 21].flatMap((w) => [td(w, 4), td(w + 3, 4)]);
    expect(loadRamp(days, day(27))!.state).toBe("steady");
  });

  it("nextMorningResponse separates the morning after hard days from rest days", async () => {
    const { nextMorningResponse } = await import("@/lib/wearables/load-analytics");
    // Train hard on even days 14..38, rest on odd days. HRV is 80 on mornings after rest
    // and 60 on mornings after a hard day. Days 0-13 build a flat 80 baseline.
    const train = Array.from({ length: 13 }, (_, k) => td(14 + k * 2, 6));
    const rec = series(40, (i) => {
      if (i < 14) return { hrv_ms: 80, resting_hr: 50 };
      const prevWasHard = i - 1 >= 14 && (i - 1) % 2 === 0;
      return prevWasHard ? { hrv_ms: 60, resting_hr: 56 } : { hrv_ms: 80, resting_hr: 50 };
    });
    const r = nextMorningResponse(train, rec)!;
    expect(r.reliable).toBe(true);
    expect(r.afterHard.n).toBeGreaterThanOrEqual(4);
    expect(r.afterHard.avgHrvPct!).toBeLessThan(-10);
    expect(r.afterHard.avgRestingHrDeltaBpm!).toBeGreaterThan(3);
    expect(Math.abs(r.afterRest.avgHrvPct!)).toBeLessThan(r.afterHard.avgHrvPct! * -1);
  });

  it("refuses to call it reliable with too few hard days, and returns null with too little data", async () => {
    const { nextMorningResponse } = await import("@/lib/wearables/load-analytics");
    // 5 trained days but only 2 count as hard for this athlete.
    const train = [td(14, 2), td(16, 2), td(18, 2), td(20, 6), td(22, 6)];
    const rec = series(30, () => ({ hrv_ms: 70, resting_hr: 52 }));
    const r = nextMorningResponse(train, rec)!;
    expect(r.afterHard.n).toBe(2);
    expect(r.reliable).toBe(false);
    expect(nextMorningResponse([td(14, 6)], rec)).toBeNull();
    expect(nextMorningResponse(train, [])).toBeNull();
  });
});

describe("daily training load RPC contract", () => {
  const sql = read("supabase/migrations/20261006150000_client_daily_training_load.sql");

  it("is gated to the athlete, their coach or an admin, and is not callable anonymously", () => {
    expect(sql).toContain("public.can_view_client_training(_client_id)");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.client_daily_training_load(uuid, int) FROM PUBLIC, anon",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.client_daily_training_load(uuid, int) TO authenticated",
    );
  });

  it("is read-only, bounded, timezone-aware and never touches XP", () => {
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(sql).not.toContain("athlete_xp_events");
    expect(sql).toContain("AT TIME ZONE tz");
    expect(sql).toContain("least(greatest(_days, 1), 365)");
  });
});

describe("where athletes find device setup", () => {
  it("puts the full setup on the Account page with a quick-jump entry, and a summary on Home", () => {
    const account = read("src/routes/_authenticated/portal/account.tsx");
    expect(account).toContain("<WearablesCard />");
    expect(account).toContain('id: "devices"');
    expect(account).toContain('id="devices"');
    expect(read("src/routes/_authenticated/portal/index.tsx")).toContain(
      '<WearablesCard mode="summary" />',
    );
  });

  it("never disappears silently when its data call fails", () => {
    const card = read("src/components/portal/wearables-card.tsx");
    expect(card).toMatch(/isError \|\| !data/);
    expect(card).toContain("aren&apos;t available right now");
  });
});
