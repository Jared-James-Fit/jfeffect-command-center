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
    expect(card).toContain("<YouPanel me={me} rows={rows} finalWeek={finalWeek} />");
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
  it("the Final Week Boost: one line inside your panel all month, one plain card in the final week", () => {
    expect(card).toContain("{!finalWeek && <BoostProgressLine me={me} />}");
    expect(card).toContain("{me?.qualified && finalWeek && (");
    expect(card).toContain("<BoostHero me={me} rows={rows} />");
  });
});

describe("Recap: on top in recap week, under the board after, never dismissible", () => {
  it("one card: above the Monthly / Strength switch only in recap week, then under the board; no ✕ or hidden state", () => {
    expect(hub).toContain("{inRecapWindow() && <LeagueRecapButton />}");
    expect(hub.indexOf("<LeagueRecapButton />")).toBeLessThan(hub.indexOf('aria-label="Leaderboard"'));
    // never both: under the board the rest of the month
    expect(card).toContain("{!inRecapWindow() && <LeagueRecapButton />}");
    expect(card.indexOf("<LeagueRecapButton />")).toBeGreaterThan(card.indexOf('aria-label="Standings"'));
    // big enough to find, plain like the page: a 56px dark thumbnail that plays, your finish under the title
    const tile = recap.slice(recap.indexOf("export function LeagueRecapButton"));
    expect(tile).toContain('className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-foreground text-background"');
    expect(tile).toContain("text-[15px] font-semibold");
    expect(tile).toContain("{result}");
    expect(tile).not.toMatch(/gradient|shadow|font-black|font-bold/);
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

describe("Monthly board: calm, plain and easy to read", () => {
  const boost = read("src/components/portal/league-boost.tsx");
  const spot = read("src/components/community/rankings-spotlight.tsx");
  it("says what the League is under its title, in one line", () => {
    expect(card).toContain("{LEAGUE_ONE_LINER}");
    expect(read("src/lib/league-standing.ts")).toContain('export const LEAGUE_ONE_LINER = "Train and log to earn points. Most points wins.";');
  });
  it("one design system: no gradients, glows, shouting caps or brand red on the board, the boost or the podiums", () => {
    for (const [name, src] of [["card", card], ["boost", boost], ["spotlight", spot]] as const) {
      expect(src, name).not.toMatch(/gradient|shadow-lg|font-black|uppercase|text-primary|bg-primary|orange-/);
    }
    // you're picked out in grey, not red
    expect(card).toContain('r.is_me && "bg-muted/60"');
    // colour only where it means something: green for an unlocked boost, amber for the last days
    expect(card).toContain('ready ? "bg-emerald-500" : "bg-foreground/70"');
    expect(card).toContain('finalWeek ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"');
  });
  it("the board is one row a person: rank, face, name, points (the final week adds one short line only when it matters)", () => {
    expect(card).toContain('<ol className="mt-3 divide-y divide-border/60 border-t border-border/60" aria-label="Standings">');
    expect(boost).not.toContain("Projected:");
  });
});
