import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeRow } from "@/lib/strength-board";
import { SPOTLIGHT_HOLD_MS, SPOTLIGHT_MS, podiumName, spotlightSlides } from "@/lib/rankings-spotlight";

const read = (p: string) => readFileSync(p, "utf8");

const league = (id: string, rank: number | null, pts: number, me = false, qualified = true) => ({
  client_id: id, display_name: id, avatar_url: null, total_points: pts, rank, qualified, is_me: me,
});
// p4p_rank is everyone together (the boards renumber per sex); abs_rank is within the sex, by total
const lifter = (key: string, sex: "male" | "female", p4p_rank: number, bw_multiple: number, kg: number, abs_rank: number, me = false) => ({
  ...normalizeRow({ client_id: key, display_name: key, sex, lift: "total", kg, lifted_at: "2026-09-01T12:00:00Z",
    bw_kg: 80, bw_multiple, p4p_rank, p4p_count: 6, abs_rank, abs_count: 3, all_rank: p4p_rank, all_count: 6, is_me: me }),
  key,
});

const base = {
  monthly: [league("Nicole Y", 1, 330), league("Reece R", 2, 320), league("You", 3, 305, true), league("Fionna G", 4, 300), league("New", null, 0, false, false)],
  previous: [league("Marc A", 1, 410), league("Vicky T", 2, 395)],
  strength: [
    lifter("Jared M", "male", 1, 10.13, 720, 1, true),
    lifter("Frederick C", "male", 2, 8.37, 617, 3),
    lifter("Nicole Y", "female", 3, 7.9, 380, 2),
    lifter("Jonathan M", "male", 4, 8.13, 640, 2),
    lifter("Vicky T", "female", 5, 6.2, 410, 1),
    lifter("Patti S", "female", 6, 5.1, 300, 3),
  ],
  division: "male" as const,
  unit: "lb" as const,
  monthStart: "2026-10-01",
  previousMonthStart: "2026-09-01",
};

describe("Rankings spotlight: every board's podium, one at a time", () => {
  it("League, then the Hall of Strength's top men and women (pound for pound, then heaviest total), then last month's Champions", () => {
    const s = spotlightSlides(base);
    expect(s.map((x) => x.key)).toEqual(["monthly", "strength:p4p:male", "strength:p4p:female", "strength:absolute:male", "strength:absolute:female", "champions"]);
    expect(s.map((x) => x.title)).toEqual([
      "October League",
      "Men · Pound for pound",
      "Women · Pound for pound",
      "Men · Heaviest total",
      "Women · Heaviest total",
      "September Champions",
    ]);
    // never "Hall of Fame": it's last month's League winners, and says so
    expect(s[5].sub).toBe("Final League standings");
    expect(s.map((x) => x.title).join()).not.toContain("Hall of Fame");
  });

  it("the League podium is the ranked top 3 in order, you marked, points as the boards show them", () => {
    const [monthly] = spotlightSlides(base);
    expect(monthly.people.map((p) => [p.name, p.value, p.me])).toEqual([["Nicole Y", "330 pts", false], ["Reece R", "320 pts", false], ["You", "305 pts", true]]);
  });

  it("strength podiums: each sex on its own, × bodyweight for pound for pound, the total in your unit for heaviest", () => {
    const by = Object.fromEntries(spotlightSlides(base).map((x) => [x.key, x]));
    expect(by["strength:p4p:male"].people.map((p) => [p.name, p.value])).toEqual([["Jared M", "10.13× BW"], ["Frederick C", "8.37× BW"], ["Jonathan M", "8.13× BW"]]);
    expect(by["strength:p4p:female"].people.map((p) => [p.name, p.value])).toEqual([["Nicole Y", "7.90× BW"], ["Vicky T", "6.20× BW"], ["Patti S", "5.10× BW"]]);
    expect(by["strength:absolute:male"].people.map((p) => [p.name, p.value])).toEqual([["Jared M", "1,587 lb"], ["Jonathan M", "1,411 lb"], ["Frederick C", "1,360 lb"]]);
    expect(by["strength:absolute:female"].people.map((p) => p.name)).toEqual(["Vicky T", "Nicole Y", "Patti S"]);
    expect(spotlightSlides({ ...base, unit: "kg" }).find((x) => x.key === "strength:absolute:female")!.people[0].value).toBe("410 kg");
    // what each one ranks, in plain words
    expect(by["strength:p4p:female"].sub).toBe("Total ÷ bodyweight · all-time best");
    expect(by["strength:absolute:female"].sub).toBe("Squat + bench + deadlift · all-time best");
    // a tap opens the board on exactly that view
    expect(by["strength:absolute:female"].view).toEqual({ mode: "absolute", division: "female" });
  });

  it("your own division leads each pair (men first when we don't know it)", () => {
    expect(spotlightSlides({ ...base, division: "female" }).map((x) => x.key).slice(1, 5)).toEqual(["strength:p4p:female", "strength:p4p:male", "strength:absolute:female", "strength:absolute:male"]);
    expect(spotlightSlides({ ...base, division: "all" }).map((x) => x.key)[1]).toBe("strength:p4p:male");
  });

  it("names fit three across: first name and last initial, like the boards", () => {
    expect(["Frederick Callahan", "Nicole Y", "Fionna Faye Gaburno", "Cher", "  ", null].map(podiumName)).toEqual(["Frederick C", "Nicole Y", "Fionna G", "Cher", "Athlete", "Athlete"]);
  });

  it("a board nobody is ranked on yet is left out", () => {
    const menOnly = base.strength.filter((r) => r.sex === "male");
    expect(spotlightSlides({ ...base, strength: menOnly, previous: [] }).map((x) => x.key)).toEqual(["monthly", "strength:p4p:male", "strength:absolute:male"]);
    expect(spotlightSlides({ ...base, monthly: [], previous: [], strength: [] })).toEqual([]);
  });

  it("time to read a podium (quick: six of them), and a swipe holds it a while", () => {
    expect(SPOTLIGHT_MS).toBe(3500);
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

  it("sits at the top of Rankings; a podium opens its board on that view (Women · Heaviest total → Women, Heaviest; Champions → last month's standings)", () => {
    const hub = read("src/components/community/league-hub.tsx");
    expect(hub.indexOf("<RankingsSpotlight")).toBeGreaterThan(hub.indexOf("<LeagueRecapButton />"));
    expect(hub.indexOf("<RankingsSpotlight")).toBeLessThan(hub.indexOf('role="tablist" aria-label="Leaderboard"'));
    expect(hub).toContain('setOpened((o) => ({ n: o.n + 1, view: slide.view ?? null, previous: slide.board === "champions" }));');
    expect(hub).toContain("<StrengthBoardSlide initialMode={opened.view?.mode} initialDivision={opened.view?.division} />");
    expect(hub).toContain("<AthleteLevelCard clientId={client.id} openPrevious={opened.previous} />");
    const board = read("src/components/portal/strength-board.tsx");
    expect(board).toContain("const [mode, setMode] = useState<BoardMode>(initialMode);");
    expect(board).toContain("const [picked, setDivision] = useState<Division | null>(initialDivision);");
    // never repeats the board open under it: it shows the other podiums
    expect(hub).toContain("<RankingsSpotlight onOpen={openFromSpotlight} under={board} underView={opened.view} />");
    const c = read("src/components/community/rankings-spotlight.tsx");
    expect(c).toContain(".filter((s) => s.key !== shownBelow)");
    expect(c).toContain('strengthSlideKey({ mode: "p4p", division })');
    // a normal tab switch or swipe never reopens what a podium asked for
    expect(hub).toContain("setOpened((o) => ({ ...o, view: null, previous: false }));");
  });
});
