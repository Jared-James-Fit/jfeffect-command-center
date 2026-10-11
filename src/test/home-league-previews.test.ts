import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leaguePreview, topThree } from "@/components/portal/home-league-previews";
import { leaguePointsFromEncoded } from "@/lib/league-points";

const row = (rank: number | null, xp: number, me = false, qualified = true) =>
  ({ client_id: `c${rank}${me}`, monthly_xp: xp, rank, is_me: me, qualified });

describe("Home League previews", () => {
  it("shows your rank, points and what it takes to pass the next person up", () => {
    const rows = [row(1, 900), row(2, 700), row(3, 500, true), row(4, 400)];
    const p = leaguePreview(rows);
    expect(p.rank).toBe(3);
    expect(p.gap?.to).toBe(2);
    expect(p.gap?.pts).toBe(leaguePointsFromEncoded(700) - leaguePointsFromEncoded(500) + 1);
  });
  it("ties: passing a score passes everyone on it; tied with someone above you, 1 point takes their spot (live October board)", () => {
    // Reece 200, Jared 185, Fionna 169, Marc 155, Nicole 155, Vicky 145, Colten 120, Jennifer 120
    const board = (meRank: number) =>
      [200, 185, 169, 155, 155, 145, 120, 120].map((p, i) => row(i + 1, p * 1000, i + 1 === meRank));
    expect(leaguePreview(board(6)).gap).toEqual({ to: 4, pts: 11 }); // Vicky: 156 passes Nicole and Marc
    expect(leaguePreview(board(8)).gap).toEqual({ to: 7, pts: 1 }); // Jennifer: tied with Colten
    expect(leaguePreview(board(5)).gap).toEqual({ to: 4, pts: 1 }); // Nicole: tied with Marc
    expect(leaguePreview(board(2)).gap).toEqual({ to: 1, pts: 16 });
  });
  it("the top three, in rank order, qualified only", () => {
    expect(topThree([row(3, 1), row(1, 3), row(null, 9, false, false), row(2, 2), row(4, 0)]).map((r) => r.rank)).toEqual([1, 2, 3]);
    const src = readFileSync("src/components/portal/home-league-previews.tsx", "utf8");
    expect(src).toContain('const MEDALS = ["🥇", "🥈", "🥉"];');
    expect(src).toContain('<span className="truncate">Hall of Strength</span>');
  });
  it("first place has nobody to catch; not qualified shows no rank", () => {
    expect(leaguePreview([row(1, 900, true), row(2, 100)]).gap).toBeNull();
    expect(leaguePreview([row(null, 0, true, false)]).rank).toBeNull();
  });
  it("Home order: calendar, body cards, crew feed, league previews, then setup (only what's left to do)", () => {
    const src = readFileSync("src/routes/_authenticated/portal/index.tsx", "utf8");
    const at = (s: string) => src.indexOf(s);
    expect(at("<UpcomingScheduleCard")).toBeLessThan(at("<SwipeCards"));
    expect(at("<SwipeCards")).toBeLessThan(at("<CommunityHomeStrip"));
    expect(at("<CommunityHomeStrip")).toBeLessThan(at("<HomeLeaguePreviews"));
    expect(at("<HomeLeaguePreviews")).toBeLessThan(at("<InstallAppCard hideWhenDone />"));
    expect(src).toContain("<NotificationSetupPrompt problemsOnly />");
    expect(src).toContain("<CalendarSyncCard hideWhenDone />");
  });
});
