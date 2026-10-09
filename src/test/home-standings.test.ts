import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const home = read("src/routes/_authenticated/portal/index.tsx");
const card = read("src/components/portal/athlete-level-card.tsx");
const carousel = read("src/components/portal/standings-carousel.tsx");
const board = read("src/components/portal/strength-board.tsx");
const recap = read("src/components/portal/league-recap.tsx");

describe("Home: one standings card instead of four", () => {
  it("League, Level and the Hall of Strength share one swipeable card", () => {
    expect(home).toContain('<AthleteLevelCard clientId={client.id} slides={[{ key: "strength", label: "Strength", node: <StrengthBoardSlide /> }]} />');
    expect(home).not.toContain("<LeagueRecapHomeTile");
    expect(home).not.toContain("<StrengthBoardCard");
    expect(card).toContain('<StandingsCarousel slides={[{ key: "league", label: "League", node: leagueSlide }, { key: "level", label: "Level", node: levelSlide }, ...slides]} />');
  });
  it("swipe or tap the labels; opens on the board you looked at last", () => {
    expect(carousel).toContain("snap-x snap-mandatory overflow-x-auto");
    expect(carousel).toContain('role="tab"');
    expect(carousel).toContain("localStorage.setItem(storageKey, String(i));");
  });
  it("every board still opens in full: Top 10, levels, competition records, the Hall of Strength, last month's recap", () => {
    expect(card).toContain("View Top 10");
    expect(card).toContain('onClick={() => setOpen("levels")}');
    expect(card).toContain('onClick={() => setOpen("powerlifting")}');
    expect(board).toContain("export function StrengthBoardSlide()");
    expect(board).toContain("<HallOfStrength />");
    expect(card).toContain('<LeagueRecapHomeTile variant="mini" className="min-w-0 flex-1" />');
    expect(recap).toContain("{playing && <LeagueRecapStory recap={playing} open={!!playing} onClose={() => setPlaying(null)} />}");
  });
  it("the level shows what just earned points", () => {
    expect(card).toContain("events.slice(0, 2).map((e) =>");
  });
  it("billing, agreements and account aren't repeated on Home (they're in the menus)", () => {
    expect(home).not.toContain("ManageAccordion");
    expect(home).not.toContain('title="Manage"');
  });
  it("the order: Today, the crew, the weigh-in, standings, then progress", () => {
    const at = (x: string) => home.indexOf(x);
    const order = ["<UpcomingScheduleCard", "<CommunityHomeStrip", "<BodyweightSummaryCard", "<AthleteLevelCard", "<ProgressSummaryCard"].map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
