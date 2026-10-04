import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { inRecapWindow, monthName, nextMonthName, ordinal, outroLine, previousLeagueMonth, rankChange, recapSeenKey, rivalLine } =
  await import("@/lib/league-recap");

const base: any = {
  month_start: "2026-09-01",
  me: { rank: 5, total_points: 280 },
  previous: { rank: 3, total_points: 345, qualified: true },
  rivals: [
    { display_name: "Fionna Faye G", gap: -5 },
    { display_name: "Marc A", gap: 85 },
    { display_name: "Nicole Y", gap: 115 },
  ],
  podium: [], league: null,
};

describe("monthly league recap", () => {
  it("targets last month and only auto-shows in the first week", () => {
    expect(previousLeagueMonth("2026-10-04")).toBe("2026-09-01");
    expect(previousLeagueMonth("2026-01-02")).toBe("2025-12-01");
    expect(inRecapWindow("2026-10-01")).toBe(true);
    expect(inRecapWindow("2026-10-07")).toBe(true);
    expect(inRecapWindow("2026-10-08")).toBe(false);
  });
  it("is seen once per month (server-side key)", () => {
    expect(recapSeenKey("2026-09-01")).toBe("league_recap:2026-09");
  });
  it("names months and ranks", () => {
    expect(monthName("2026-09-01")).toBe("September");
    expect(nextMonthName("2026-12-01")).toBe("January");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  });
  it("describes rank movement vs the month before", () => {
    expect(rankChange(base)).toEqual({ dir: "down", text: "Down 2 spots from August" });
    expect(rankChange({ ...base, me: { rank: 2 } })).toEqual({ dir: "up", text: "Up 1 spot from August" });
    expect(rankChange({ ...base, previous: null })).toBeNull();
  });
  it("frames each rival head-to-head and picks the nearest one ahead to chase", () => {
    expect(rivalLine(-5)).toEqual({ tone: "win", text: "You beat them by 5" });
    expect(rivalLine(85)).toEqual({ tone: "loss", text: "85 pts ahead of you" });
    expect(outroLine(base)).toBe("Marc A finished 85 pts ahead. This month, close the gap.");
    expect(outroLine({ ...base, me: { rank: 1 } })).toMatch(/defend the crown/);
  });
  it("only exposes leaderboard-public data about other athletes", () => {
    const sql = readFileSync("supabase/migrations/20261004200000_league_month_recap.sql", "utf8");
    const rivals = sql.slice(sql.indexOf("'rivals'"));
    expect(rivals).not.toMatch(/adherence|eligible_workouts|bodyweight_value/);
    expect(sql).toContain("where s.user_id = auth.uid()");
  });
});
