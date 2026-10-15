import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientBottomNav, clientNav } from "@/lib/admin-nav";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const home = read("src/routes/_authenticated/portal/index.tsx");
const card = read("src/components/portal/athlete-level-card.tsx");
const swipe = read("src/components/portal/swipe-cards.tsx");
const board = read("src/components/portal/strength-board.tsx");
const recap = read("src/components/portal/league-recap.tsx");
const hub = read("src/components/community/league-hub.tsx");
const screen = read("src/components/community/community-screen.tsx");
const crew = read("src/components/community/crew-list.tsx");

describe("the centre tab is Crew: the feed and the rankings in one place", () => {
  it("the raised button says Crew (trophy kept), and the menu finds it by any name", () => {
    const centre = clientBottomNav.find((i) => i.featured);
    expect(centre).toMatchObject({ to: "/portal/community", label: "Crew" });
    const menu = clientNav.find((i) => i.to === "/portal/community");
    expect(menu?.label).toBe("Crew");
    expect(menu?.keywords).toEqual(expect.arrayContaining(["league", "leaderboard", "rankings", "community", "feed", "crew", "members"]));
  });
  it("Feed · Rankings; Activity is the heart beside them, Members opens from Activity, and your profile is its first row", () => {
    expect(screen).toContain('(["feed", "rankings"] as const)');
    expect(screen).toContain("<RankingsHub />");
    expect(screen).toContain('aria-label={activityNew ? "Activity, new" : "Activity"}');
    expect(screen).toContain('const PARENT: Partial<Record<Tab, Tab>> = { activity: "feed", members: "activity" };');
    expect(read("src/components/community/crew-activity.tsx")).toContain('aria-label="Find people"');
    expect(crew).toContain("data-crew-me");
    expect(screen).toContain('onOpenMe={() => setScope({ kind: "you", from: "members" })}');
  });
  it("opens on the Feed; ranking links land on Rankings (Monthly or Strength)", () => {
    expect(screen).toContain('if (rankingsFromHash()) return { kind: "rankings" };');
    expect(screen).toContain('return { kind: "feed" };');
    expect(hub).toContain('return /(rankings|league)=strength/.test(hash) ? "strength" : "monthly";');
    expect(read("src/components/community/share-composer.tsx")).toContain('navigate({ to: "/portal/community", hash: "feed" })');
    expect(read("src/components/community/use-workout-studio.ts")).toContain('navigate({ to: "/portal/community", hash: "feed" })');
    expect(read("src/lib/push/app-events.server.ts")).toContain('url: () => "/portal/community#feed"');
  });
  it("only the feed clears the new-posts count (opening on Rankings doesn't)", () => {
    expect(screen).toContain('if (markedRef.current || !feed.isSuccess || scope.kind !== "feed") return;');
  });
  it("a profile's back button returns to the tab you came from", () => {
    expect(screen).toContain("{TAB_LABEL[tab]}");
    expect(screen).toContain("const tab: Tab = scope.kind === \"author\" || scope.kind === \"you\" ? scope.from : scope.kind;");
  });
  it("small phones get a round + for Share so the tabs keep their room", () => {
    expect(screen).toContain('labelClassName="max-[389px]:sr-only"');
    expect(read("src/components/community/share-workout-picker.tsx")).toContain("aria-label={labelClassName ? label : undefined}");
  });
});

describe("Rankings", () => {
  it("Monthly and Strength: one board at a time, never stacked", () => {
    expect(hub).toContain('([["monthly", "Monthly"], ["strength", "Strength"]] as const)');
    expect(hub).toContain('board === "strength" ? (');
    expect(hub).toContain("<StrengthBoardSlide />");
    expect(hub).toContain("<AthleteLevelCard clientId={client.id}");
  });
  it("one Live mark in the Rankings header (not on each board); scoring rules folded under the board", () => {
    expect(hub).toContain("one Live mark for the page");
    // the app's shared live indicator, once
    expect(hub.match(/<LiveMark /g)?.length).toBe(1);
    expect(card).not.toContain("<LiveMark");
    expect(card).not.toContain("animate-ping");
    expect(card).toContain("How points work");
    expect(card.match(/How to earn points/g)).toBeNull();
  });
  it("the Monthly board is titled by the month (October League), with the days left", () => {
    expect(card).toContain("{monthName(monthStart)} League");
    expect(card).toContain("{monthClockLabel(finalWeek)}");
  });
  it("Monthly: only the Top 10 (and you, if you're below it), never the whole roster; no record pills by names; every row opens that athlete", () => {
    expect(card).toContain("const SHOWN = 10;");
    expect(card).toContain("[...shown, ...(meBelow ? [meBelow] : [])]");
    expect(card).not.toContain("Show all");
    expect(card).not.toContain("RecordBadges");
    // last month's final standings: the same Top 10
    expect(card).toContain("{listed.map((r) => (");
    expect(card).toContain("onOpen={() => openAthlete(r.client_id)}");
    expect(card).toContain('hideCloseButton={sheet?.kind === "athlete"}');
    expect(card).not.toContain("View Rankings");
  });
  it("Strength: Top 10 on the page, Show all expands inline, Meets only is one toggle; no View Rankings", () => {
    expect(board).toContain("pickBoard(data, mode, lift, division, showAll ? Infinity : TOP)");
    expect(board).toContain('{showAll ? "Show top 10" : `Show all ${count} athletes`}');
    expect(board).toContain('aria-pressed={source === "meets"}');
    expect(board).toContain("Meets only");
    const slide = board.slice(board.indexOf("export function StrengthBoardSlide()"), board.indexOf("function KingTile("));
    expect(slide).not.toContain("View Rankings");
  });
  it("everything still opens: athlete details, careers, recap story", () => {
    expect(card).not.toContain('setOpen("levels")');
    expect(board).toContain("if (career) return <PowerliftingCareer athleteId={career} />;");
    expect(recap).toContain("You finished ${ordinal(recap.me.rank)}");
    expect(recap).toContain("<LeagueRecapStory recap={recap} open={open} onClose={() => setOpen(false)} />");
  });
  it("Logging Level is gone from the client app (its points still feed Milestones)", () => {
    expect(card).not.toContain("Logging Level</span>");
    expect(card).not.toContain("LevelsView");
    expect(card).toContain("<MyAchievementsRow catalog={catalog} earned={earned} metrics={stats} />");
    expect(read("src/components/records/workout-points-card.tsx")).not.toContain("TrendingUp");
  });
  it("new-milestone reveals pop on Home, once (not again on Rankings)", () => {
    expect(home).toContain("{client?.id && <LevelCelebrations clientId={client.id} />}");
    expect(card).toContain("export function LevelCelebrations(");
    // only LevelCelebrations shows them
    expect(card.match(/<AchievementCelebrations /g)?.length).toBe(1);
  });
});

describe("Home: what you do today, and one Body swipe", () => {
  it("Bodyweight, Water and Progress share one spot; the standings left Home", () => {
    expect(home).toContain('storageKey="jf-home-body"');
    const swipeAt = home.indexOf("<SwipeCards");
    const order = ["<BodyweightSummaryCard", "<HomeWaterCard", "<ProgressSummaryCard"].map((x) => home.indexOf(x));
    expect(order.every((i) => i > swipeAt)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(home).not.toContain("<AthleteLevelCard");
    expect(home).not.toContain("<StrengthBoardSlide");
  });
  it("swipe or tap the labels; the height follows the card you're on; opens on the one you looked at last", () => {
    expect(swipe).toContain("snap-x snap-mandatory");
    expect(swipe).toContain('role="tab"');
    expect(swipe).toContain("new ResizeObserver(sync)");
    expect(swipe).toContain("style={height ? { height } : undefined}");
    expect(swipe).toContain("localStorage.setItem(storageKey, String(i));");
  });
  it("billing, agreements and account aren't repeated on Home (they're in the menus)", () => {
    expect(home).not.toContain("ManageAccordion");
    expect(home).not.toContain('title="Manage"');
  });
});

describe("SwipeCards always lands on a whole card", () => {
  it("height follows only after the swipe settles, and settle snaps to the nearest card", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/portal/swipe-cards.tsx", "utf8");
    expect(src).toMatch(/settleTimer\.current = window\.setTimeout\(settle, 140\)/);
    expect(src).toMatch(/addEventListener\("scrollend", onEnd\)/);
    expect(src).toMatch(/el\.scrollTo\(\{ left: target, behavior: "smooth" \}\)/);
    expect(src).toMatch(/snap-center snap-always/);
  });
});
