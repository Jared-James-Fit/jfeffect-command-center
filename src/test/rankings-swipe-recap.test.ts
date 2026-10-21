import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardAfterSwipe } from "@/components/community/league-hub";

const read = (p: string) => readFileSync(p, "utf8");
const hub = read("src/components/community/league-hub.tsx");
const card = read("src/components/portal/athlete-level-card.tsx");
const recap = read("src/components/portal/league-recap.tsx");
const home = read("src/routes/_authenticated/portal/index.tsx");

describe("Rankings: swipe between Monthly and Strength", () => {
  it("left goes to Strength, right back to Monthly; nothing past either end", () => {
    expect(boardAfterSwipe("monthly", -120, 5)).toBe("strength");
    expect(boardAfterSwipe("strength", 120, 5)).toBe("monthly");
    expect(boardAfterSwipe("monthly", 120, 5)).toBeNull();
    expect(boardAfterSwipe("strength", -120, 5)).toBeNull();
  });
  it("taps, short drags and vertical scrolling never switch", () => {
    expect(boardAfterSwipe("monthly", -8, 2)).toBeNull();
    expect(boardAfterSwipe("monthly", -59, 0)).toBeNull();
    expect(boardAfterSwipe("monthly", -100, 90)).toBeNull();
    expect(boardAfterSwipe("monthly", -100, 400)).toBeNull();
  });
  it("one state for the tabs and the swipe; only touches on the board itself (not sheets, inputs or sliders)", () => {
    expect(hub).toContain("onClick={() => setBoard(k)}");
    expect(hub).toContain("if (next) setBoard(next);");
    expect(hub).toContain("boardRef.current?.contains(target)");
    expect(hub).toContain('closest?.("input, textarea, [role=slider], [data-no-swipe]")');
    expect(hub).toContain("e.touches.length === 1");
    expect(hub).toContain("[touch-action:pan-y_pinch-zoom]");
  });
});

describe("Monthly board: you first, one board, the rest folded", () => {
  it("your rank, points and next step sit above the board; the breakdown is one tap away", () => {
    expect(card).toContain("<YouPanel me={me} rows={rows} />");
    expect(card.indexOf("<YouPanel")).toBeLessThan(card.indexOf('aria-label="Standings"'));
    expect(card).toContain("{standingText(standing)}");
    expect(card).toContain("aria-expanded={open}");
    expect(card).toContain("<MonthBreakdown me={me} />");
    expect(card).toContain('<CoachFocus me={me} title="Your next moves" />');
    // no second "your month" card repeating the same rank and gap
    expect(card).not.toContain("data-your-month");
    expect(card).not.toContain("pts to crack the Top 10");
  });
  it("one query for the board and its sheets (shared with Home)", () => {
    expect(card).toContain('usePerformanceLeague("current")');
    expect(card).not.toContain("get_monthly_athlete_rankings");
  });
  it("last month's final standings and the rules sit under the board, the rules folded", () => {
    expect(card).toContain("final standings");
    expect(card.indexOf("final standings <ChevronRight")).toBeGreaterThan(card.indexOf('aria-label="Standings"'));
    expect(card).toContain('<details className="group px-4 py-1">');
    expect(card).toContain("{TIEBREAK_NOTE}");
    // the tie rule is its own line in the rules, not buried in the fine print
    expect(card).toContain("data-tiebreak-rule");
    expect(card.indexOf("data-tiebreak-rule")).toBeLessThan(card.indexOf("Final Week Boost: finish 90%+"));
  });
  it("the Final Week Boost: a quiet progress line all month, the race card in the final week", () => {
    expect(card).toContain("me?.qualified && finalWeek ? (");
    expect(card).toContain("<BoostHero me={me} rows={rows} />");
    expect(card).toContain("<BoostProgressLine me={me} />");
  });
});

describe("Recap: on top in recap week, a quiet row under the board after, never dismissible", () => {
  it("the banner above the Monthly / Strength switch only in recap week; then one row under the board; no ✕ or hidden state", () => {
    expect(hub).toContain("{inRecapWindow() && <LeagueRecapButton />}");
    expect(hub.indexOf("<LeagueRecapButton />")).toBeLessThan(hub.indexOf('aria-label="Leaderboard"'));
    // never both: the row is the rest of the month
    expect(card).toContain('{!inRecapWindow() && <LeagueRecapButton variant="row" />}');
    expect(card.indexOf('<LeagueRecapButton variant="row" />')).toBeGreaterThan(card.indexOf('aria-label="Standings"'));
    expect(recap).not.toContain("Dismiss recap");
    expect(recap).not.toContain("jf-recap-dismissed");
    expect(recap).not.toMatch(/localStorage/);
  });
  it("only last month's recap: it rolls over on the 1st, so nothing piles up", () => {
    const btn = recap.slice(recap.indexOf("export function LeagueRecapButton"));
    expect(btn).toContain("const month = previousLeagueMonth();");
    expect(btn).toContain("{fresh && <span");
    expect(recap).not.toContain("LeagueRecapHomeTile");
  });
});

describe("Home order", () => {
  it("Today → Progress (Rankings live in Crew, not on Home)", () => {
    const today = home.indexOf('aria-label="Today"');
    const progress = home.indexOf('aria-label="Progress"');
    expect(today).toBeGreaterThan(-1);
    expect(today).toBeLessThan(progress);
    expect(home).not.toContain("HomeLeaguePreviews");
  });
});
