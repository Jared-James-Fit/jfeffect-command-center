import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20270111090000_manitoba_time_zone.sql", "utf8");

describe("Manitoba stays on UTC-5 from Nov 1, 2026 in the database", () => {
  it("converts Manitoba wall time with a fixed UTC-5 from that date, every other zone by its own rules", () => {
    expect(sql).toMatch(/IN \('America\/Winnipeg', 'Canada\/Central', 'America\/Rainy_River'\)\s+AND _local >= timestamp '2026-11-01 00:00'\s+THEN 'Etc\/GMT\+5'/);
    expect(sql).toMatch(/AND _at >= timestamptz '2026-11-01 05:00\+00'\s+THEN 'Etc\/GMT\+5'/);
  });

  it("a session's start and end, and its 'today', go through those conversions", () => {
    expect(sql).toContain("NEW.starts_at := public.local_to_instant(NEW.session_date + NEW.start_time, NEW.timezone);");
    expect(sql).toContain("NEW.ends_at   := public.local_to_instant(NEW.session_date + NEW.end_time, NEW.timezone);");
    expect(sql).toContain("RETURN public.instant_to_local(now(), _tz)::date;");
  });
});
