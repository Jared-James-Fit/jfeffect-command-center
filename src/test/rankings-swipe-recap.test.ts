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

describe("Your month: shown, not folded", () => {
  it("no accordion; breakdown, Coach's Focus and the rest render right under the Top 10", () => {
    expect(card).not.toContain("<details data-your-month");
    expect(card).toContain('<div data-your-month className="space-y-3 rounded-2xl border bg-card p-4">');
    expect(card).toContain("<MonthBreakdown me={me as BoostLeagueRow} />");
    expect(card).toContain('{boostMe && <CoachFocus me={boostMe} className="mt-3" />}');
    expect(card).toContain("final standings");
  });
});

describe("Recap: once, at the top of Rankings", () => {
  it("compact and dismissible, above the Monthly / Strength switch, nowhere else in Rankings", () => {
    expect(hub.indexOf("<LeagueRecapButton compact />")).toBeGreaterThan(-1);
    expect(hub.indexOf("<LeagueRecapButton compact />")).toBeLessThan(hub.indexOf('aria-label="Leaderboard"'));
    expect(card).not.toContain("LeagueRecapButton");
    expect(recap).toContain('aria-label="Dismiss recap"');
    expect(recap).toContain("const dismissKey = `jf-recap-dismissed:${month}`;");
  });
});

describe("Home order", () => {
  it("Today → Rankings → Progress", () => {
    const today = home.indexOf('aria-label="Today"');
    const rankings = home.indexOf("<HomeLeaguePreviews />");
    const progress = home.indexOf('aria-label="Progress"');
    expect(today).toBeGreaterThan(-1);
    expect(today).toBeLessThan(rankings);
    expect(rankings).toBeLessThan(progress);
  });
});
