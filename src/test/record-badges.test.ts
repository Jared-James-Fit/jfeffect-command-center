import { describe, expect, it } from "vitest";
import { FRESH_RECORD_MS, hasRecords, isFreshRecord } from "@/components/portal/record-badges";

describe("league record badges", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  it("only animates records set in the last 48 hours", () => {
    expect(isFreshRecord(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isFreshRecord(new Date(now - FRESH_RECORD_MS - 1).toISOString(), now)).toBe(false);
    expect(isFreshRecord(null, now)).toBe(false);
    expect(isFreshRecord("not a date", now)).toBe(false);
  });
  it("hides the badge row when an athlete has no records", () => {
    expect(hasRecords({})).toBe(false);
    expect(hasRecords({ atpr_lifts: 0, program_pr_lifts: 0, block_pr_lifts: 0 })).toBe(false);
    expect(hasRecords({ block_pr_lifts: 1 })).toBe(true);
  });
});
