import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAROUSEL_CARDS,
  COLOR,
  GRID_MIN_HEADLINE_PT,
  GRID_SCALE,
  SURFACES,
  TYPE,
  contrastRatio,
  designProblems,
  hookFit,
  reportProblems,
  surfaceContrastProblems,
} from "@/lib/post-design";
import { DECK_LIMITS, DECK_THEMES, DARK_COVERS, pickDeckTheme, themesFor } from "@/lib/post-decks";
import { recapSlides, statsSlideCount, winsSlides } from "@/lib/stats-slides";
import { instagramPlan, MULTI_CARDS } from "@/lib/instagram-export";
import { postArtKey, POST_ART_VERSION } from "@/lib/post-art";
import { headlineProblems, needsHeadlinePolish, readHeadline, stem } from "@/lib/post-headlines";
import { FIXTURES } from "../../scripts/post-design/fixtures";

const read = (p: string) => readFileSync(p, "utf8");
const fixture = (label: string) => FIXTURES.find((f) => f.label === label)!.post;

describe("the design system's colours read", () => {
  it("every surface's ink, supporting words, accent and words on the accent pass their contrast", () => {
    expect(surfaceContrastProblems()).toEqual([]);
  });
  it("is black, off-white, graphite and the JF red, nothing else as a surface", () => {
    expect(Object.keys(SURFACES).sort()).toEqual(["black", "graphite", "offwhite", "red"]);
    expect(contrastRatio(COLOR.white, COLOR.red)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COLOR.offwhite, COLOR.black)).toBeGreaterThan(15);
  });
});

describe("a headline reads in the three-across profile grid", () => {
  it("the smallest hook still reads at grid size", () => {
    expect(TYPE.hook.min * GRID_SCALE).toBeGreaterThanOrEqual(GRID_MIN_HEADLINE_PT);
  });
  it("a short cover fits big; a long one is flagged before it's published", () => {
    expect(hookFit("Soreness isn't proof it *worked*")!.px).toBeGreaterThanOrEqual(180);
    expect(designProblems([{ type: "cover", title: "Soreness isn't proof it worked" }])).toEqual([]);
    const long = "Why the athletes who never miss a week are usually not the most motivated people in the gym at all";
    expect(designProblems([{ type: "cover", title: long }]).join(" ")).toMatch(/too long|only fits small/);
    // the writer is held to what fits
    expect(DECK_LIMITS.coverTitle.words).toBeLessThanOrEqual(8);
  });
  it("a painted card's report flags small, faint or clipped type", () => {
    const ok = { card: "deck", slide: 0, scale: 1, clipped: false, texts: [{ role: "hook" as const, px: 160, fg: COLOR.offwhite, bg: COLOR.black }] };
    expect(reportProblems(ok)).toEqual([]);
    expect(reportProblems({ ...ok, texts: [{ role: "hook", px: 80, fg: COLOR.offwhite, bg: COLOR.black }] }).join()).toMatch(/grid/);
    expect(reportProblems({ ...ok, texts: [{ role: "body", px: 50, fg: "#777777", bg: "#888888" }] }).join()).toMatch(/contrast/);
    expect(reportProblems({ ...ok, clipped: true })).toContain("content didn't fit");
  });
});

describe("decks: a look per post, varied in the grid, suited to the content", () => {
  it("never repeats the last three, flips dark and light, and prefers what suits the content", () => {
    const t = pickDeckTheme("seed", ["slate"], themesFor("lesson", "truth"));
    expect(t).not.toBe("slate");
    expect(DARK_COVERS.has(t)).toBe(false);
    // a truth lesson after a light cover goes bold
    expect(["red", "slate"]).toContain(pickDeckTheme("x", ["paper"], themesFor("lesson", "truth")));
    for (const seed of ["a", "b", "c", "d"]) expect(DECK_THEMES).toContain(pickDeckTheme(seed));
  });
});

describe("Wins and the Recap are carousels with one big number up front", () => {
  it("counts its slides from the stats and paints a picture per slide", () => {
    const wins = fixture("Wednesday Wins");
    const recap = fixture("Sunday Recap");
    expect(winsSlides(wins.series_data as never)).toEqual(["hero", "numbers", "weeks"]);
    expect(recapSlides(recap.series_data as never)).toEqual(["hero", "numbers", "days", "moments"]);
    expect(statsSlideCount(recap)).toBe(4);
    expect(instagramPlan(wins)).toMatchObject({ card: "wins", cards: 3 });
    expect(MULTI_CARDS.has("recap")).toBe(true);
    expect(CAROUSEL_CARDS).toBe(MULTI_CARDS);
    // each slide its own picture, and a new design version repaints every post
    expect(postArtKey(wins, "wins", "lb", 2)).toContain(".wins.s2.");
    expect(postArtKey(wins, "wins", "lb", 0)).toMatch(new RegExp(`^v${POST_ART_VERSION}\\.`));
    expect(POST_ART_VERSION).toBeGreaterThanOrEqual(6);
  });
});

describe("tightening an existing cover keeps what it says", () => {
  const source = "You need less protein than the internet says. 1.6 g/kg. Where muscle gain levels off. Hit the daily total first.";
  it("only covers too long for the grid need it", () => {
    expect(needsHeadlinePolish("You need *less* protein than you think")).toBe(false);
    expect(needsHeadlinePolish("Why the athletes who never miss a week usually aren't the most motivated ones in the room")).toBe(true);
  });
  it("refuses a rewrite that adds a number, a new idea, a question or runs long", () => {
    expect(headlineProblems("You need *less* protein", "You need less protein than the internet says", source)).toEqual([]);
    expect(headlineProblems("You need 2 g of protein", "x", source).join()).toMatch(/number/);
    expect(headlineProblems("Creatine beats protein timing daily", "x", source).join()).toMatch(/words the post doesn't use/);
    expect(headlineProblems("Do you need less protein?", "x", source).join()).toMatch(/question/);
    expect(headlineProblems("You need less protein than the internet keeps on saying every day", "x", source).join()).toMatch(/words/);
  });
  it("reads the model's answer and stems words alike", () => {
    expect(readHeadline('sure {"title": "You need *less* protein"}')).toBe("You need *less* protein");
    expect(readHeadline("nope")).toBeNull();
    expect(stem("Lifting")).toBe(stem("lifts"));
  });
});

describe("one system, every card, nothing old to fall back on", () => {
  it("the painters draw from the design system and the old paper look is gone", () => {
    const cards = read("src/lib/instagram-cards.ts");
    const deck = read("src/lib/deck-cards.ts");
    for (const src of [cards, deck]) expect(src).toContain('from "@/lib/post-design-paint"');
    expect(cards).not.toContain('const PAPER = "#f6f3ee"');
    expect(deck).not.toMatch(/instrument-serif|PALETTES\.blush/);
  });
  it("the headline job never spends Lovable credits and the migration keeps engagement", () => {
    expect(read("src/lib/post-headlines.server.ts")).toContain("openaiOnly: true");
    const sql = read("supabase/migrations/20270529090000_post_design_system.sql");
    expect(sql).toContain("UPDATE public.community_posts SET updated_at = v_updated WHERE id = _post;");
    expect(sql).toContain("p.edited_at IS NULL AND p.series_data #>> '{deck,slides,0,title}' = _old");
    expect(sql).not.toMatch(/DELETE FROM public\.community_posts|INSERT INTO public\.community_posts|community_reactions|community_comments/);
  });
});
