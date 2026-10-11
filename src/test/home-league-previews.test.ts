import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leaguePreview } from "@/components/portal/home-league-previews";
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
  it("first place has nobody to catch; not qualified shows no rank", () => {
    expect(leaguePreview([row(1, 900, true), row(2, 100)]).gap).toBeNull();
    expect(leaguePreview([row(null, 0, true, false)]).rank).toBeNull();
  });
  it("Home order: calendar, body cards, crew feed, league previews, setup", () => {
    const src = readFileSync("src/routes/_authenticated/portal/index.tsx", "utf8");
    const at = (s: string) => src.indexOf(s);
    expect(at("<UpcomingScheduleCard")).toBeLessThan(at("<SwipeCards"));
    expect(at("<SwipeCards")).toBeLessThan(at("<CommunityHomeStrip"));
    expect(at("<CommunityHomeStrip")).toBeLessThan(at("<HomeLeaguePreviews"));
    expect(at("<HomeLeaguePreviews")).toBeLessThan(at('title="Setup"'));
  });
});
