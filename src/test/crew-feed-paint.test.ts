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
      'paintCardFile(postRef.current, card, "feed", unit, host, 0, whenStill), { whenStill: true, rank }',
    );
    expect(art).toContain("if (pause) await pause();");
    // Share to Instagram asks right away (a tap), never waiting on the screen
    const share = read("src/components/community/instagram-share-sheet.tsx");
    expect(share).not.toContain("whenStill");
  });
});
