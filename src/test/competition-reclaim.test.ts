import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Nov 25 2026: the host killed a worker request (Cloudflare 1102) right after
 * it claimed the validation's game plan. Its OpenAI call was parked in
 * progress.pending, yet the milestone waited ten minutes and the reclaim used
 * one of its three tries. The claim and the cron's condition read one rule.
 */
const sql = readFileSync(
  "supabase/migrations/20270528090000_competition_reclaim_cut_off_runs.sql",
  "utf8",
);

describe("a run the host cuts off is picked up in minutes, without using a try", () => {
  it("a lock older than 3 minutes is stale in both the claim and the cron's condition", () => {
    const claim = sql.slice(sql.indexOf("FUNCTION public.competition_milestone_claim"));
    const due = sql.slice(sql.indexOf("FUNCTION public.competition_intel_due"));
    for (const body of [claim, due])
      expect(body).toMatch(
        /status = 'generating' AND x\.locked_at < now\(\) - interval '3 minutes'\s+AND \(x\.attempts < 3 OR public\.competition_milestone_parked\(x\.progress\)\)/,
      );
  });
  it("resuming a call parked at OpenAI keeps the attempt count", () => {
    expect(sql).toMatch(
      /WHEN m\.status = 'generating' AND public\.competition_milestone_parked\(m\.progress\) THEN m\.attempts/,
    );
  });
  it("a parked run is never failed for its tries", () => {
    expect(sql).toMatch(/AND NOT public\.competition_milestone_parked\(progress\)/);
  });
});
