import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeRow } from "@/lib/strength-board";
import { SPOTLIGHT_HOLD_MS, SPOTLIGHT_MS, podiumName, spotlightSlides } from "@/lib/rankings-spotlight";

const read = (p: string) => readFileSync(p, "utf8");

const league = (id: string, rank: number | null, pts: number, me = false, qualified = true) => ({
  client_id: id, display_name: id, avatar_url: null, total_points: pts, rank, qualified, is_me: me,
});
const lifter = (key: string, sex: "male" | "female", p4p_rank: number, bw_multiple: number, me = false) => ({
  ...normalizeRow({ client_id: key, display_name: key, sex, lift: "total", kg: 500, lifted_at: "2026-09-01T12:00:00Z",
    bw_kg: 80, bw_multiple, p4p_rank, p4p_count: 5, all_rank: p4p_rank, all_count: 5, is_me: me }),
  key,
});

const base = {
  monthly: [league("Nicole Y", 1, 330), league("Reece R", 2, 320), league("You", 3, 305, true), league("Fionna G", 4, 300), league("New", null, 0, false, false)],
  previous: [league("Marc A", 1, 410), league("Vicky T", 2, 395)],
  strength: [lifter("Jared M", "male", 1, 10.13, true), lifter("Frederick C", "male", 2, 8.37), lifter("Nicole Y", "female", 3, 7.9), lifter("Jonathan M", "male", 4, 8.13)],
  meets: [lifter("Frederick C", "male", 1, 8.37), lifter("Jonathan M", "male", 2, 8.13)],
  division: "male" as const,
  monthStart: "2026-10-01",
  previousMonthStart: "2026-09-01",
};

describe("Rankings spotlight: every board's podium, one at a time", () => {
  it("League, Hall of Strength, Competition, then the Hall of Fame (last month's champions)", () => {
    const s = spotlightSlides(base);
    expect(s.map((x) => x.key)).toEqual(["monthly", "strength", "competition", "fame"]);
    expect(s.map((x) => x.title)).toEqual(["October League", "Hall of Strength", "Competition record", "Hall of Fame"]);
    expect(s[3].sub).toBe("September champions");
  });

  it("the League podium is the ranked top 3 in order, you marked, points as the boards show them", () => {
    const [monthly] = spotlightSlides(base);
    expect(monthly.people.map((p) => [p.name, p.value, p.me])).toEqual([["Nicole Y", "330 pts", false], ["Reece R", "320 pts", false], ["You", "305 pts", true]]);
  });

  it("strength podiums: pound for pound, total, the viewer's division (the boards' own default)", () => {
    const s = spotlightSlides(base);
    expect(s[1].sub).toBe("Men · pound for pound");
    expect(s[1].people.map((p) => [p.name, p.value])).toEqual([["Jared M", "10.13× BW"], ["Frederick C", "8.37× BW"], ["Jonathan M", "8.13× BW"]]);
    expect(s[2].people.map((p) => p.name)).toEqual(["Frederick C", "Jonathan M"]);
    expect(spotlightSlides({ ...base, division: "female" })[1].people.map((p) => p.name)).toEqual(["Nicole Y"]);
  });

  it("names fit three across: first name and last initial, like the boards", () => {
    expect(["Frederick Callahan", "Nicole Y", "Fionna Faye Gaburno", "Cher", "  ", null].map(podiumName)).toEqual(["Frederick C", "Nicole Y", "Fionna G", "Cher", "Athlete", "Athlete"]);
  });

  it("a board nobody is ranked on yet is left out", () => {
    expect(spotlightSlides({ ...base, meets: [], previous: [] }).map((x) => x.key)).toEqual(["monthly", "strength"]);
    expect(spotlightSlides({ ...base, monthly: [], previous: [], strength: [], meets: [] })).toEqual([]);
  });

  it("time to read a podium, and a swipe holds it a while", () => {
    expect(SPOTLIGHT_MS).toBe(5000);
    expect(SPOTLIGHT_HOLD_MS).toBe(10_000);
  });

  it("only moves while someone's looking; ⏸ stops it on this device; reduced motion never moves", () => {
    const c = read("src/components/community/rankings-spotlight.tsx");
    expect(c).toContain("const playing = cycling && !stopped && onScreen && appVisible && !touching && !hovered && !held;");
    expect(c).toContain("const cycling = n > 1 && !reduced;");
    expect(c).toContain('localStorage.setItem(SPOTLIGHT_PAUSED_KEY, next ? "1" : "0");');
    // the progress line is the clock (pausing pauses exactly)
    expect(c).toContain("onAnimationEnd={() => go(1)}");
    // its own sideways swipe, not the page's swipe-back
    expect(c).toContain("data-no-swipe-back");
  });

  it("sits at the top of Rankings; a podium opens its board (Competition on meets, Hall of Fame on last month's standings)", () => {
    const hub = read("src/components/community/league-hub.tsx");
    expect(hub.indexOf("<RankingsSpotlight")).toBeGreaterThan(hub.indexOf("<LeagueRecapButton />"));
    expect(hub.indexOf("<RankingsSpotlight")).toBeLessThan(hub.indexOf('role="tablist" aria-label="Leaderboard"'));
    expect(hub).toContain('source: key === "competition" ? "meets" : "all", previous: key === "fame"');
    expect(hub).toContain("<StrengthBoardSlide initialSource={opened.source} />");
    expect(hub).toContain("<AthleteLevelCard clientId={client.id} openPrevious={opened.previous} />");
    // a normal tab switch or swipe never reopens what a podium asked for
    expect(hub).toContain('setOpened((o) => ({ ...o, source: "all", previous: false }));');
  });
});
