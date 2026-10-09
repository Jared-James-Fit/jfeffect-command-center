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

describe("the centre tab is League: standings and the crew in one place", () => {
  it("the raised button says League, and the menu finds it by either name", () => {
    const centre = clientBottomNav.find((i) => i.featured);
    expect(centre).toMatchObject({ to: "/portal/community", label: "League" });
    const menu = clientNav.find((i) => i.to === "/portal/community");
    expect(menu?.label).toBe("League & Community");
    expect(menu?.keywords).toEqual(expect.arrayContaining(["league", "leaderboard", "community", "feed", "crew"]));
  });
  it("League · Feed · Crew; your profile is the first row of Crew", () => {
    expect(screen).toContain('(["league", "feed", "crew"] as const)');
    expect(screen).toContain("<LeagueHub />");
    expect(crew).toContain("data-crew-me");
    expect(screen).toContain('onOpenMe={() => setScope({ kind: "you", from: "crew" })}');
  });
  it("opens on the League, or the feed when there's something new in it (links to a post always land on the feed)", () => {
    expect(screen).toContain('if (/(post|at)=|#feed/.test(hash)) return { kind: "feed" };');
    expect(screen).toContain('return (activity?.unseen ?? 0) > 0 ? { kind: "feed" } : { kind: "league" };');
    expect(read("src/components/community/share-composer.tsx")).toContain('navigate({ to: "/portal/community", hash: "feed" })');
    expect(read("src/components/community/use-workout-studio.ts")).toContain('navigate({ to: "/portal/community", hash: "feed" })');
    expect(read("src/lib/push/app-events.server.ts")).toContain('url: () => "/portal/community#feed"');
  });
  it("only the feed clears the new-posts count (opening on the League doesn't)", () => {
    expect(screen).toContain('if (markedRef.current || !feed.isSuccess || scope.kind !== "feed") return;');
  });
  it("a profile's back button returns to the tab you came from", () => {
    expect(screen).toContain("{TAB_LABEL[tab]}");
    expect(screen).toContain("const tab: Tab = scope.kind === \"author\" || scope.kind === \"you\" ? scope.from : scope.kind;");
  });
  it("small phones get a round + for Share so the three tabs keep their room", () => {
    expect(screen).toContain('labelClassName="max-[389px]:sr-only"');
    expect(read("src/components/community/share-workout-picker.tsx")).toContain("aria-label={labelClassName ? label : undefined}");
  });
});

describe("the League tab", () => {
  it("one swipe first: the crew goal (always the default) and the Logging Level; then the League and the Hall of Strength", () => {
    expect(hub.indexOf("<CrewGoalCard />")).toBeLessThan(hub.indexOf("<AthleteLevelCard"));
    expect(hub).toContain('const crew = goal ? { key: "crew", label: "Crew goal", node: <CrewGoalCard /> } : undefined;');
    expect(hub).toContain('<AthleteLevelCard clientId={client.id} levelSwipe={crew} boards={[{ key: "strength", node: <StrengthBoardSlide /> }]} />');
    expect(card).toContain('storageKey="jf-league-top"');
    expect(card).toContain("remember={false}");
    expect(card.indexOf("levelSwipe,")).toBeLessThan(card.indexOf('{ key: "level", label: "Logging Level"'));
    expect(card).toContain('? [{ key: "league", node: leagueCard }, ...boards]');
    // no crew goal this week: the level is its own card again
    expect(card).toContain(': [{ key: "league", node: leagueCard }, ...boards, { key: "level", node: levelCard }];');
    expect(swipe).toContain("if (!remember) return;");
    expect(card).toContain("data-standing={c.key}");
  });
  it("the race is for the Top 10: the card shows 5, See top 10 opens 6-10 in place, you're always shown; every row opens that athlete", () => {
    expect(card).toContain("Number(r.rank)<=10");
    expect(card).toContain("const shownTo = showTen ? 10 : 5;");
    expect(card).toContain("[...top10.slice(3, shownTo), ...(outside && leagueMe ? [leagueMe] : [])]");
    expect(card).toContain('{showTen ? "Show top 5" : "See top 10"}');
    expect(card).toContain("pts to Top 10");
    expect(card).toContain("onClick={() => openRankings(r.client_id)}");
  });
  it("every board still opens in full: standings, levels, competition records, the Hall of Strength, last month's recap", () => {
    expect(card).toContain("Full standings");
    expect(card).toContain('onClick={() => setOpen("levels")}');
    expect(card).toContain('onClick={() => setOpen("powerlifting")}');
    expect(board).toContain("export function StrengthBoardSlide()");
    expect(board).toContain("<HallOfStrength />");
    expect(board).toContain("pickBoard(data, mode, lift, division, 5)");
    expect(board).toContain("<HallOfStrength initialMode={mode} initialLift={lift} initialDivision={division} />");
    expect(card).toContain('<LeagueRecapHomeTile variant="mini" />');
    expect(recap).toContain("You finished ${ordinal(recap.me.rank)} place");
    expect(recap).toContain("{playing && <LeagueRecapStory recap={playing} open={!!playing} onClose={() => setPlaying(null)} />}");
  });
  it("the level shows what just earned points", () => {
    expect(card).toContain("events.slice(0, 2).map((e) =>");
  });
  it("new-milestone reveals pop on Home, once (not again on the League tab)", () => {
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
