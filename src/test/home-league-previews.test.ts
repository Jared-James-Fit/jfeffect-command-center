import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { standingOf, standingText } from "@/lib/league-standing";

const row = (rank: number | null, pts: number, me = false, qualified = true) =>
  ({ client_id: `c${rank}${me}`, display_name: `A${rank}`, total_points: pts, rank, is_me: me, qualified });

describe("League standing lines (Rankings, level card)", () => {
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
    expect(standingText(standingOf(board(1)), true)).toBe("Tied · you were first");
    expect(standingOf(board(2))).toMatchObject({ kind: "tied", with: { rank: 1 } });
    expect(standingText(standingOf(board(2)), true)).toBe("Tied with #1");
    expect(standingText(standingOf(board(3)), true)).toBe("21 pts behind #2");
    expect(standingText(standingOf(board(5)), true)).toBe("20 pts behind #4");
  });
  it("first place says the lead; alone on the board; not qualified shows no rank", () => {
    expect(standingText(standingOf([row(1, 900, true), row(2, 100)]), true)).toBe("Leading by 800 pts");
    expect(standingOf([row(1, 50, true)]).kind).toBe("solo");
    expect(standingOf([row(null, 0, true, false)]).kind).toBe("unranked");
    expect(standingText(standingOf([row(null, 0, true, false)]), true)).toBe("Log your bodyweight to join this month");
  });
});

describe("Home: today, then Bodyweight, Water and Progress as their own cards", () => {
  const home = readFileSync("src/routes/_authenticated/portal/index.tsx", "utf8");
  const at = (x: string) => home.indexOf(x);
  it("Rankings aren't repeated on Home (Crew → Rankings has them)", () => {
    expect(home).not.toContain("HomeLeaguePreviews");
    expect(home).not.toContain("Hall of Strength");
    expect(home).not.toContain("<CommunityHomeStrip");
  });
  it("no tabs: the three cards follow each other down the page, weigh-in first", () => {
    expect(home).not.toContain("<SwipeCards");
    expect(home).toContain("<HomeSectionLabel>Progress</HomeSectionLabel>");
    const order = ["<UpcomingScheduleCard", 'aria-label="Progress"', "<BodyweightSummaryCard", "<HomeWaterCard", "<ProgressSummaryCard", "<WearablesCard", "<InstallAppCard hideWhenDone />"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // each card loads on its own as you get near it
    expect(home.match(/<DeferRender placeholderHeight="h-(80|72)">/g)?.length).toBe(3);
  });
  it("setup cards only while something's left to do", () => {
    expect(home).toContain("<NotificationSetupPrompt problemsOnly />");
    expect(home).toContain("<CalendarSyncCard hideWhenDone />");
  });
});
