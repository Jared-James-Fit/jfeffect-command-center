import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DECK_THEMES, deckHeadline, deckOf, deckSlideAlt, emphasisRuns, parseDeck, pickDeckTheme, stripEmphasis, type PostDeck } from "@/lib/post-decks";
import { captionOverlap, deckProblems, likeness, namesIn, numbersIn } from "@/lib/post-deck-checks";
import { DECK_TRIES, deckSource, parseEditor, sourceText, writeDeck } from "@/lib/post-decks.server";
import { instagramPlan, postArtCard } from "@/lib/instagram-export";
import { postArtKey } from "@/lib/post-art";
import type { CommunityPost } from "@/lib/community";

// Nov 16 2026's protein lesson, as it went out
const PROTEIN = `A 2018 look at 49 studies checked how much protein you actually need to build muscle. Gains kept going up until about 1.6 g per kg of bodyweight a day. After that they flattened out.

That's about 0.7 g per lb of bodyweight. The top of their range was about 1 g per lb. So a 198 lb lifter wants about 145 to 200 g a day.

Hitting your total most days matters way more than timing or shakes. If you're on a dietitian's plan though, follow theirs.`;

const GOOD: PostDeck = {
  v: 1,
  theme: "blush",
  slides: [
    { type: "cover", kicker: "Hypertrophy", title: "You need *less* protein than the internet says" },
    { type: "stat", value: "1.6 g/kg", label: "is where muscle gains stopped climbing", note: "A 2018 review of 49 studies" },
    { type: "point", n: 1, title: "That's about 0.7 g per lb", body: "A 198 lb lifter lands around 145 to 200 g a day." },
    { type: "compare", myth: true, left: { label: "Overrated", text: "Shake timing and the anabolic window" }, right: { label: "What counts", text: "Your daily total, most days" } },
    { type: "takeaway", title: "Hit the total. *Stop counting minutes.*", body: "On a dietitian's plan? Follow theirs." },
  ],
  caption: "most people asking me about timing haven't nailed their daily number yet. get that right for a month and then we can talk about the small stuff, because that's where the muscle actually comes from",
};

const ctx = { source: PROTEIN };

describe("decks: reading one", () => {
  it("reads a deck from the post, its series data or its series extra, the cover first", () => {
    expect(deckOf({ deck: GOOD })?.slides).toHaveLength(5);
    expect(deckOf({ series_extra: { deck: GOOD } })?.theme).toBe("blush");
    expect(deckOf({ series_data: { deck: GOOD } })?.caption).toBe(GOOD.caption);
    expect(deckOf({ series_extra: { kind: "cue" } })).toBeNull();
    // no cover first, or no caption: not a deck
    expect(parseDeck({ slides: GOOD.slides.slice(1), caption: "x" })).toBeNull();
    expect(parseDeck({ slides: GOOD.slides, caption: "" })).toBeNull();
    // a slide that doesn't read is dropped, an unknown theme falls back
    const d = parseDeck({ theme: "neon", slides: [...GOOD.slides, { type: "nope" }, { type: "list", title: "x", items: [] }], caption: "c" });
    expect(d?.theme).toBe("paper");
    expect(d?.slides).toHaveLength(5);
  });

  it("splits accents and strips them for the words", () => {
    expect(emphasisRuns("You need *less* protein")).toEqual([
      { text: "You need ", accent: false },
      { text: "less", accent: true },
      { text: " protein", accent: false },
    ]);
    expect(stripEmphasis("Hit the *total*.")).toBe("Hit the total.");
    expect(deckHeadline(GOOD)).toBe("You need less protein than the internet says");
    expect(deckSlideAlt(GOOD, 3)).toBe("Overrated: Shake timing and the anabolic window. What counts: Your daily total, most days");
  });

  it("never picks the theme of either of the two posts before", () => {
    for (let i = 0; i < 40; i++) {
      const t = pickDeckTheme(`seed-${i}`, ["red", "paper"]);
      expect(DECK_THEMES).toContain(t);
      expect(["red", "paper"]).not.toContain(t);
    }
    // the same seed always the same look
    expect(pickDeckTheme("a", [])).toBe(pickDeckTheme("a", []));
  });
});

describe("decks: the checks", () => {
  it("passes a good deck", () => {
    expect(deckProblems(GOOD, ctx)).toEqual([]);
  });

  it("wants a claim on the cover, never a question or a template opener", () => {
    const q = { ...GOOD, slides: [{ type: "cover" as const, title: "How much protein do you actually need?" }, ...GOOD.slides.slice(1)] };
    expect(deckProblems(q, ctx).join(" | ")).toMatch(/the hook is a question/);
    const t = { ...GOOD, slides: [{ type: "cover" as const, title: "Did you know protein builds muscle" }, ...GOOD.slides.slice(1)] };
    expect(deckProblems(t, ctx).join(" | ")).toMatch(/opens like a template/);
  });

  it("catches a caption that only says the slides again", () => {
    const dup = { ...GOOD, caption: "That's about 0.7 g per lb. A 198 lb lifter lands around 145 to 200 g a day. Hit the total and stop counting minutes, it's what matters." };
    expect(captionOverlap(dup.caption, dup).share).toBeGreaterThan(0.2);
    expect(deckProblems(dup, ctx).join(" | ")).toMatch(/caption repeats the slides|caption says what a slide says/);
  });

  it("never lets a number or a name in that isn't in the source", () => {
    const made = { ...GOOD, slides: GOOD.slides.map((s, i) => (i === 1 ? { ...s, value: "2.2 g/kg" } : s)) as PostDeck["slides"] };
    expect(deckProblems(made, ctx).join(" | ")).toMatch(/numbers that aren't in the source: 2.2/);
    expect(numbersIn("six straight titles, 1,000 reps at 0.7")).toEqual(expect.arrayContaining(["6", "1000", "0.7"]));
    const named = { ...GOOD, caption: `${GOOD.caption}. a review by Brad Schoenfeld agrees.` };
    expect(namesIn(named.caption)).toContain("Brad Schoenfeld");
    expect(deckProblems(named, ctx).join(" | ")).toMatch(/names that aren't in the source/);
    // small counts are free: 3 reps left, 2 sets
    expect(deckProblems({ ...GOOD, caption: `${GOOD.caption}. 3 sets is plenty for most of you` }, ctx).join(" | ")).not.toMatch(/numbers/);
  });

  it("catches engagement bait, overstated research, hype and his never-say lines", () => {
    const p = (caption: string) => deckProblems({ ...GOOD, caption: `${GOOD.caption}. ${caption}` }, ctx).join(" | ");
    expect(p("what's yours?")).toMatch(/asks for engagement/);
    expect(p("save this for later")).toMatch(/asks for engagement/);
    expect(p("science proves it")).toMatch(/overstates the research/);
    expect(p("let that sink in")).toMatch(/reads like AI/);
    expect(p("trust the process")).toMatch(/a slogan/);
    expect(p("huge one — really")).toMatch(/dash/);
  });

  it("keeps slides phone-sized and a carousel varied, ending on a takeaway that isn't the hook", () => {
    const long = { ...GOOD, slides: GOOD.slides.map((s, i) => (i === 2 ? { type: "point" as const, title: "That's about 0.7 g per lb", body: "word ".repeat(40).trim() } : s)) };
    expect(deckProblems(long, ctx).join(" | ")).toMatch(/slide 3's words is too long/);
    const same = { ...GOOD, slides: [GOOD.slides[0], ...Array.from({ length: 4 }, (_, i) => ({ type: "point" as const, n: i + 1, title: "That's about 0.7 g per lb" })), GOOD.slides[4]] };
    expect(deckProblems(same, ctx).join(" | ")).toMatch(/four slides of one kind in a row/);
    const noEnd = { ...GOOD, slides: GOOD.slides.slice(0, 4) };
    expect(deckProblems(noEnd, ctx).join(" | ")).toMatch(/ends on a takeaway/);
    const echo = { ...GOOD, slides: [...GOOD.slides.slice(0, 4), { type: "takeaway" as const, title: "You need less protein than the internet says" }] };
    expect(deckProblems(echo, ctx).join(" | ")).toMatch(/only repeats the hook/);
    expect(deckProblems({ ...GOOD, slides: GOOD.slides.slice(0, 2) }, ctx).join(" | ")).toMatch(/2 slides/);
  });

  it("gives a diagram a slide only when the lesson has one", () => {
    const withDiagram = { ...GOOD, slides: [GOOD.slides[0], { type: "diagram" as const, title: "Where gains flatten out" }, ...GOOD.slides.slice(1)] };
    expect(deckProblems(withDiagram, ctx).join(" | ")).toMatch(/no diagram for this post/);
    expect(deckProblems(GOOD, { ...ctx, diagram: true }).join(" | ")).toMatch(/give it a slide/);
  });

  it("knows a hook that's the same as a recent one", () => {
    expect(likeness("You need less protein than the internet says", "You need way less protein than the internet says")).toBeGreaterThanOrEqual(0.7);
    expect(deckProblems(GOOD, { ...ctx, recentCovers: ["You need way less protein than the internet says"] }).join(" | ")).toMatch(/too close to a recent post/);
  });
});

describe("decks: the editor and the writer", () => {
  it("reads the editor strictly: publish only when every score clears its bar", () => {
    const all = { hook: 5, value: 4, accuracy: 5, voice: 4, caption: 4, flow: 5 };
    expect(parseEditor({ scores: all, verdict: "publish", notes: [] })?.verdict).toBe("publish");
    expect(parseEditor({ scores: { ...all, accuracy: 4 }, verdict: "publish" })?.verdict).toBe("revise");
    expect(parseEditor({ scores: { ...all, hook: 3 }, verdict: "publish" })?.verdict).toBe("revise");
    expect(parseEditor({ scores: { hook: 5 }, verdict: "publish" })).toBeNull();
  });

  const src = deckSource("lesson", PROTEIN, { track: "hypertrophy", title: "How much protein do you actually need?" });
  const publish = JSON.stringify({ scores: { hook: 5, value: 5, accuracy: 5, voice: 4, caption: 4, flow: 5 }, verdict: "publish", notes: [] });

  it("returns a deck that passed the checks and the editor, in the theme it was given", async () => {
    const asked: string[] = [];
    const ask = async (system: string, prompt: string) => {
      asked.push(system.startsWith("You turn") ? "write" : "edit");
      return { text: system.startsWith("You turn") ? "```json\n" + JSON.stringify(GOOD) + "\n```" : publish, model: "openai:test" };
    };
    const out = await writeDeck(src, { ask, theme: "slate", recentCovers: [] });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.deck.theme).toBe("slate");
      expect(out.deck.model).toBe("openai:test");
    }
    expect(asked).toEqual(["write", "edit"]);
  });

  it("sends a draft back with what's wrong, and gives up after its tries", async () => {
    const prompts: string[] = [];
    let n = 0;
    const ask = async (system: string, prompt: string) => {
      if (!system.startsWith("You turn")) return { text: publish, model: "m" };
      prompts.push(prompt);
      n++;
      const deck = n === 1 ? { ...GOOD, slides: [{ type: "cover", title: "How much protein do you need?" }, ...GOOD.slides.slice(1)] } : GOOD;
      return { text: JSON.stringify(deck), model: "m" };
    };
    const out = await writeDeck(src, { ask, theme: "paper", recentCovers: [] });
    expect(out.ok).toBe(true);
    expect(prompts[1]).toMatch(/FIX THESE IN THIS DRAFT[\s\S]*the hook is a question/);

    const never = async (system: string) => ({ text: system.startsWith("You turn") ? JSON.stringify(GOOD) : JSON.stringify({ scores: { hook: 3, value: 4, accuracy: 5, voice: 4, caption: 4, flow: 4 }, verdict: "revise", notes: ["sharper hook"] }), model: "m" });
    const failed = await writeDeck(src, { ask: never, theme: "paper", recentCovers: [] });
    expect(failed.ok).toBe(false);
    expect(failed.attempts).toHaveLength(DECK_TRIES);
  });

  it("reads a lesson's card and diagram into the source, and never names its authors as fact", () => {
    const s = deckSource("lesson", "body", { track: "truth", title: "Soreness", visual: { kind: "truth", belief: "If I'm not sore it didn't work", truth: "Sore means new" }, refs: [{ label: "Schoenfeld 2013" }] });
    expect(s.card).toMatch(/The belief: If I'm not sore/);
    expect(s.diagram).toBeNull();
    expect(sourceText(s)).toMatch(/Schoenfeld 2013/);
    const d = deckSource("lesson", "body", { track: "fix", title: "Sticking point", lift: "bench", visual: { kind: "sticking_point", lift: "bench" } });
    expect(d.diagram).toMatch(/bar speed/);
    expect(deckSource("tuesday_tips", "tip", { kind: "externals" }).about).toMatch(/Control what you can/);
  });
});

describe("decks: in the app", () => {
  const post = {
    id: "p1",
    created_at: "2026-11-20T12:00:00Z",
    kind: "note",
    series: "lesson",
    caption: GOOD.caption,
    media_path: null,
    media_type: null,
    deck: GOOD,
    series_extra: { track: "hypertrophy", title: "Protein", deck: GOOD },
    mentions: [],
  } as unknown as CommunityPost;

  it("an automated post with a deck is its slides: one picture each, keyed by slide", () => {
    expect(instagramPlan(post)).toMatchObject({ card: "deck", cards: 5 });
    expect(postArtCard(post)).toBe("deck");
    const k0 = postArtKey(post, "deck", "lb", 0);
    const k3 = postArtKey(post, "deck", "lb", 3);
    expect(k0).not.toBe(k3);
    expect(k3).toMatch(/\.deck\.s3\./);
    // a new deck is a new picture
    expect(postArtKey({ ...post, deck: { ...GOOD, theme: "red" } }, "deck", "lb", 0)).not.toBe(k0);
  });

  it("the database hands the deck to the app and publishes its caption only while it matches the words", () => {
    const sql = readFileSync("supabase/migrations/20270429090000_crew_post_decks.sql", "utf8");
    expect(sql).toMatch(/'deck', CASE WHEN n\.series IS NOT NULL THEN n\.series_data->'deck' END/);
    expect(sql).toMatch(/coalesce\(r\.body, v_deck->>'caption', v_item\.body\)/);
    expect(sql).toMatch(/v_caption := coalesce\(public\.community_deck_current\(v_item\.body, v_item\.data\)->>'caption', v_item\.body\)/);
    expect(sql).toMatch(/encode\(sha256\(convert_to\(coalesce\(_body, ''\), 'UTF8'\)\), 'hex'\)/);
    // posts already out are fixed in place, never one the coach edited
    expect(sql).toMatch(/AND p\.edited_at IS NULL/);
  });
});
