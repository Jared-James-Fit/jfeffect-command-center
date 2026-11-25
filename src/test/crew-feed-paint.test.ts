import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_UNDER_MIN } from "@/lib/feed-paging";
import {
  STILL_MS,
  loadPostArt,
  nextPaint,
  peekPostArt,
  resetPostArt,
  stillScreen,
} from "@/lib/post-art";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 15 2026: a lesson's card in the paged feed showed its top half over
 * black, cut off mid-line, with no name, words or buttons under it. Each
 * screen eased in (opacity + a rise), which made it a layer of its own that an
 * iPhone paints a 512px strip at a time, and the phone was busy painting the
 * next cards (canvas + JPEG) while the swipe landed, so the strips under the
 * first two were never painted.
 */
describe("a swipe never lands on a half-painted post", () => {
  it("cards are painted only while the screen is still", () => {
    // a finger down: never, however long ago it last moved (up to a lost touchend)
    expect(stillScreen(10_000, 9_000, 1, false)).toBe(false);
    // a lost touchend (a system gesture took the finger): not a finger
    expect(stillScreen(20_000, 9_000, 1, false)).toBe(true);
    // a scroll a moment ago: not yet
    expect(stillScreen(10_000, 10_000 - STILL_MS + 1, 0, false)).toBe(false);
    expect(stillScreen(10_000, 10_000 - STILL_MS, 0, false)).toBe(true);
    // the app in the background: nothing to paint for
    expect(stillScreen(10_000, 0, 0, true)).toBe(false);
  });

  it("a tap's paint goes first; else the card nearest the screen, only once it's still", () => {
    const far = { urgent: false, rank: () => 1200 };
    const on = { urgent: false, rank: () => 0 };
    const gone = {
      urgent: false,
      rank: () => {
        throw new Error("gone");
      },
    };
    expect(nextPaint([far, on, gone], true)).toBe(1);
    expect(nextPaint([far, on], false)).toBe(-1);
    expect(nextPaint([far, { urgent: true }, on], false)).toBe(1);
    expect(nextPaint([gone, far], true)).toBe(1);
    expect(nextPaint([], true)).toBe(-1);
    // a tie: the order asked
    expect(nextPaint([{ urgent: false, rank: () => 0 }, on], true)).toBe(0);
  });

  describe("painting", () => {
    let n = 0;
    beforeEach(() => {
      resetPostArt();
      n = 0;
      vi.stubGlobal(
        "URL",
        Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: () => {} }),
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("the feed's paint and a tap's ask for the same card paint it once", async () => {
      const paint = vi.fn(async () => new Blob(["x"], { type: "image/jpeg" }));
      const feed = loadPostArt("k1", "a.jpg", paint, { whenStill: true, rank: () => 0 });
      const tap = loadPostArt("k1", "a.jpg", paint);
      const [a, b] = await Promise.all([feed, tap]);
      expect(paint).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
      expect(peekPostArt("k1")?.file.name).toBe("a.jpg");
    });

    it("nearest first: two cards waiting paint the one on screen first", async () => {
      const order: string[] = [];
      const paint = (k: string) => async () => {
        order.push(k);
        return new Blob([k], { type: "image/jpeg" });
      };
      await Promise.all([
        loadPostArt("far", "f.jpg", paint("far"), { whenStill: true, rank: () => 1500 }),
        loadPostArt("near", "n.jpg", paint("near"), { whenStill: true, rank: () => 0 }),
      ]);
      expect(order).toEqual(["near", "far"]);
    });
  });

  it("the paged feed's screens are simply there: no easing in, no layer of their own", () => {
    const screen = read("src/components/community/community-screen.tsx");
    const pager = screen.slice(
      screen.indexOf("function FeedPager("),
      screen.indexOf("function useStoriesSwipe("),
    );
    expect(pager).not.toContain("<FeedItem");
    expect(pager).toMatch(/<div\s+key=\{pg\.key\}\s+data-post-id=\{pg\.post\.id\}/);
    // the coach's card feed still eases its posts in
    expect(screen).toContain("<FeedItem index={i} data-post-id={p.id}");
  });

  it("the first post at rest drops its moving layer (a snap lands a hair short)", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("if (u >= FIRST_UNDER_MIN) {");
    expect(FIRST_UNDER_MIN).toBeGreaterThan(0);
    expect(FIRST_UNDER_MIN).toBeLessThan(0.02);
  });

  it("the feed's cards wait for a still screen, nearest first, and pause again before encoding", () => {
    const art = read("src/components/community/post-art.tsx");
    expect(art).toContain(
      'paintCardFile(postRef.current, card, "feed", unit, host, slide, whenStill, slide), { whenStill: true, rank }',
    );
    expect(art).toContain("if (pause) await pause();");
    // Share to Instagram asks right away (a tap), never waiting on the screen
    const share = read("src/components/community/instagram-share-sheet.tsx");
    expect(share).not.toContain("whenStill");
  });
});

describe("an automated post appears all at once (Nov 20 2026)", () => {
  const art = read("src/components/community/post-art.tsx");
  const lib = read("src/lib/post-art.ts");

  it("a kept card is read from the phone as soon as its post is on the page, not when it reaches the screen", () => {
    expect(art).toContain("// as soon as the post is on the page: the one kept on the phone (a read, nothing drawn), so it's ready long before it's seen");
    expect(art).toContain("if (near && missing && art?.key !== key) setPainting(true);");
    // the painting's font and logo are fetched as soon as a card needs painting
    expect(art).toContain("void ensureDisplayFont();");
    expect(art).toContain("void cardLogo();");
  });

  it("the card goes on the page only once it's decoded, with no fade and no blank paper first", () => {
    expect(lib).toContain("export function decodePostArt(art: PostArt): Promise<void> {");
    expect(lib).toContain("await img.decode();");
    expect(art).toContain("const shown = useDecodedArt(art, near || eager);");
    expect(art).toContain('<img src={src} alt={alt} decoding="sync" draggable={false} className="absolute inset-0 h-full w-full object-cover" />');
    expect(art).not.toContain("media-fade");
    expect(art).not.toContain("animate-pulse");
    // the paper is only under a card that's there (or the words fallback)
    expect(art).toContain('shown || failed ? "bg-[#f3f1ec]" : page ? "bg-transparent" : "bg-muted"');
  });

  it("on a post's screen its words and buttons wait for the card it opens on, never longer than the hold", () => {
    expect(art).toContain('data-pending={page && hold && pending && !gaveUp ? "" : undefined}');
    const css = read("src/styles.css");
    expect(css).toContain(".feed-page:has([data-post-art][data-pending]) :is([data-page-words], [data-page-actions]) { visibility: hidden; }");
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("<AutoPostHero post={post} thumbUrl={thumbUrl} unit={unit} page />");
    // the card it opens on holds; a card that trails a photo never does
    expect(card).toContain("lead={<PostArtImage post={post} card={card} unit={unit} fill eager={full} page={page} hold={page} />}");
    expect(card).toContain("trail={card ? <PostArtImage post={post} card={card} unit={unit} fill page={page} /> : undefined}");
  });
});

describe("decodePostArt", () => {
  it("never marks a picture decoded that isn't the one kept in memory", async () => {
    const { decodePostArt, isPostArtDecoded, resetPostArt } = await import("@/lib/post-art");
    resetPostArt();
    expect(isPostArtDecoded("nope")).toBe(false);
    // a picture not in memory is never marked decoded (it was evicted or never read)
    await decodePostArt({ key: "k1", url: "blob:none", file: new File([], "a.jpg") });
    expect(isPostArtDecoded("k1")).toBe(false);
  });
});
