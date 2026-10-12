import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { topThree } from "@/components/portal/home-league-previews";
import { standingOf, standingText } from "@/lib/league-standing";

const row = (rank: number | null, pts: number, me = false, qualified = true) =>
  ({ client_id: `c${rank}${me}`, display_name: `A${rank}`, total_points: pts, rank, is_me: me, qualified });

describe("Home League previews", () => {
  it("says how far you are behind the athlete right above you", () => {
    const rows = [row(1, 900), row(2, 700), row(3, 500, true), row(4, 400)];
    const s = standingOf(rows);
    expect(s).toMatchObject({ kind: "behind", pts: 200, of: { rank: 2 } });
    expect(standingText(s, true)).toBe("200 pts behind #2");
    expect(standingText(s)).toBe("200 pts behind A2 (#2)");
  });
  it("ties are said as ties, never a made-up '1 pt' (live October board: Reece and Jared both on 200)", () => {
    const board = (meRank: number) => [200, 200, 179, 175, 155].map((p, i) => row(i + 1, p, i + 1 === meRank));
    expect(standingOf(board(1))).toMatchObject({ kind: "tied-top", with: { rank: 2 } });
    expect(standingText(standingOf(board(1)), true)).toBe("Tied on points");
    expect(standingOf(board(2))).toMatchObject({ kind: "tied", with: { rank: 1 } });
    expect(standingText(standingOf(board(2)), true)).toBe("Tied with #1");
    expect(standingText(standingOf(board(3)), true)).toBe("21 pts behind #2");
    expect(standingText(standingOf(board(5)), true)).toBe("20 pts behind #4");
  });
  it("the top three, in rank order, qualified only", () => {
    expect(topThree([row(3, 1), row(1, 3), row(null, 9, false, false), row(2, 2), row(4, 0)]).map((r) => r.rank)).toEqual([1, 2, 3]);
    const src = readFileSync("src/components/portal/home-league-previews.tsx", "utf8");
    expect(src).toContain('const MEDALS = ["🥇", "🥈", "🥉"];');
    expect(src).toContain('<span className="truncate">Hall of Strength</span>');
  });
  it("first place says the lead; alone on the board; not qualified shows no rank", () => {
    expect(standingText(standingOf([row(1, 900, true), row(2, 100)]), true)).toBe("Leading by 800 pts");
    expect(standingOf([row(1, 50, true)]).kind).toBe("solo");
    expect(standingOf([row(null, 0, true, false)]).kind).toBe("unranked");
    expect(standingText(standingOf([row(null, 0, true, false)]), true)).toBe("Log your bodyweight to join this month");
  });
  it("Home order: calendar, one Rankings card (no feed shelf), body cards, then setup (only what's left to do)", () => {
    const src = readFileSync("src/routes/_authenticated/portal/index.tsx", "utf8");
    const at = (s: string) => src.indexOf(s);
    expect(at("<UpcomingScheduleCard")).toBeLessThan(at("<HomeLeaguePreviews"));
    expect(at("<HomeLeaguePreviews")).toBeLessThan(at("<SwipeCards"));
    expect(src).not.toContain("<CommunityHomeStrip");
    expect(at("<SwipeCards")).toBeLessThan(at("<InstallAppCard hideWhenDone />"));
    expect(src).toContain("<NotificationSetupPrompt problemsOnly />");
    expect(src).toContain("<CalendarSyncCard hideWhenDone />");
  });
  it("the Rankings card: Monthly first, swipe to Strength, dots, one Live mark, View all opens the page you're on", () => {
    const src = readFileSync("src/components/portal/home-league-previews.tsx", "utf8");
    expect(src).toContain('useState<Slide>("monthly")');
    expect(src).toContain("snap-x snap-mandatory");
    expect(src).toContain('aria-label="Rankings page"');
    expect(src.match(/animate-ping/g)?.length).toBe(1);
    expect(src).toContain('hash={slide === "strength" ? "rankings=strength" : "rankings"}');
    expect(src).not.toMatch(/setInterval|setTimeout/);
    expect(src).toContain('pickBoard(board, "p4p", "total", division, 3)');
    // one league query for Home and Crew → Rankings; the board you land on is the one Home shows
    expect(src).toContain('usePerformanceLeague("current")');
    expect(src).not.toContain("get_monthly_athlete_rankings");
    expect(src).toContain("const division = defaultDivision(board);");
    expect(src).toContain("note={standingText(standing, true)}");
    expect(src).toContain("{!leaguePending && boost && (");
  });
});
