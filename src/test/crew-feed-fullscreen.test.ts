import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUBBLE_FOLD_SPAN, BUBBLE_WAVE, FEED_GAP_MAX, bubbleFold, ease, feedGap, storiesProgress } from "@/lib/feed-paging";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("every post fills the screen, TikTok's way", () => {
  const css = read("src/styles.css");
  const card = read("src/components/community/post-card.tsx");

  it("a screen is the window's measured height, read again only on a rotation (never a toolbar or the keyboard)", () => {
    const lib = read("src/lib/feed-paging.ts");
    expect(lib).toContain("vh = Math.round(window.innerHeight);");
    expect(lib).toContain('root.style.setProperty("--feed-vh", `${vh}px`);');
    // a resize at the same width (a toolbar, a keyboard) only reads the gap again, never the pages' height
    expect(lib).toContain("if (window.innerWidth === width) return setGap();");
    expect(read("src/components/community/community-screen.tsx")).toContain("const unwatch = watchFeedViewport();");
  });

  it("each post fills the screen down to the tab bar, Crew's bar floating over its top", () => {
    expect(css).toContain("  --feed-bar-room: calc(3rem + var(--app-edge-room));");
    expect(css).toContain("  --feed-nav-room: max(0px, calc(var(--mobile-bar-top) - var(--feed-gap, 0px)));");
    // the post itself runs from under the status bar down to the tab bar (opaque, TikTok's)
    expect(card).toContain("style={{ top: -raise, bottom: sheetOpen ? `calc(${POST_SHEET_HEIGHT} - var(--feed-gap, 0px))` : \"var(--feed-nav-room)\" }}");
    // a picture shown whole sits between Crew's bar and the post's words; a clip that fills the screen runs under both
    expect(card).toContain('const BETWEEN_BARS = { top: "var(--feed-bar-room)", bottom: "var(--feed-words-room, 0px)" } as const;');
    expect(card).toContain("<FitBox ratio={0.8} page shrunk={sheetOpen}>");
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain('const between = controls === "top" && fit === "contain";');
    // what sits at the top of a post (the set's caption, "2/4", the speaker) moves down under the bar
    expect(card).toContain('style={top ? { paddingTop: "calc(var(--feed-bar-room, 0px) + 0.75rem)" } : undefined}');
    expect(card).toContain('page ? "top-[calc(var(--feed-bar-room)+0.625rem)]" : "top-2.5"');
    // a post with its sheet open has nothing floating over it
    expect(css).toContain("[data-sheet-open] { --feed-bar-room: 0px; --feed-nav-room: 0px; --feed-words-room: 0px; }");
  });

  it("a picture or card shown whole sits above the post's words, never under them (TikTok's); only a clip that fills the screen runs under them (Nov 13 2026)", () => {
    // how tall the words are, measured inside their own box and kept up to date: never where they sit,
    // which the screen's reading settling (--feed-gap) moves with nothing resizing (a stale position left
    // every picture a gap short of its words on the iPhone home-screen app, Nov 13 2026)
    expect(card).toContain("const h = box.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(box).paddingBottom) || 0) - w.getBoundingClientRect().top;");
    expect(card).toContain('if (h > 0) a.style.setProperty("--page-words-h", `${Math.round(h)}px`);');
    expect(card).not.toContain("--page-words-top");
    expect(card).toContain("<div ref={wordsRef} className=");
    // the room they take: their height, how far up they sit, less where the hero ends (the tab bar), and 8px;
    // the last two both move with --feed-gap, so the room is the same however the screen reads
    expect(css).toContain("[data-feed-page-post] { --feed-words-room: calc(var(--page-words-h, 0px) + var(--feed-words-bottom) - var(--feed-nav-room) + 8px); }");
    // photos, cards and clips shown whole all sit in it
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain('const BETWEEN_BARS = { top: "var(--feed-bar-room, 0px)", bottom: "var(--feed-words-room, 0px)" } as const;');
    expect(inline).toContain('height: "calc(100% - var(--feed-bar-room, 0px) - var(--feed-words-room, 0px))",');
    expect(card).toContain('style={page && !screen ? { ...BETWEEN_BARS, containerType: "size" } : { containerType: "size" }}');
    // the shade under the words only over a clip that fills its screen (a carousel's slides say how they sit)
    expect(css).toContain('[data-feed-page-post="visual"]:has([data-fit="cover"]) > [data-page-words] {');
    expect(card).not.toContain('visual && "bg-gradient-to-t from-black/75 via-black/35 to-transparent"');
    expect(card).toContain("data-fit={page ? fits?.[j] : undefined}");
    // every line under a post is room its picture loses: the views and the coach's ❤️ share one (Nov 13 2026)
    expect(card).toContain('<div className="flex min-w-0 items-center gap-2 [&_[data-post-views]]:mx-0 [&_[data-post-views]]:mb-0 [&_[data-post-views]]:shrink-0" data-page-meta>');
    expect(card).toContain("data-page-coach>");
  });

  it("the words and the buttons down the right sit just above the tab bar (nothing stands over the bar any more)", () => {
    expect(css).toContain("  --feed-words-bottom: max(12px, calc(var(--mobile-bar-top) + 12px - var(--feed-gap, 0px)));");
    expect(css).toContain("  --feed-actions-bottom: max(8px, calc(var(--mobile-bar-top) + 8px - var(--feed-gap, 0px)));");
    expect(read("src/components/app-shell.tsx")).not.toContain("top-[-33px]");
    // their shade runs down under the tab bar
    expect(card).toContain('"pointer-events-none absolute inset-x-0 bottom-0 z-[2] pt-16 transition-opacity duration-200"');
  });

  it("the paged feed is dark whatever the theme: the posts, Crew's bar, the tab bar and the status bar", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("const overFeed = useFeedPaging();");
    expect(shell).toContain('overFeed ? "dark border-white/10 bg-black text-foreground" : "border-border/70 bg-background"');
    expect(css).toContain("html.feed-paging:not([data-pov-banner-on]) .ios-status-band { background-color: #000; }");
    expect(read("src/components/community/crew-header.tsx")).toContain('overlay && "dark text-foreground"');
  });
});

describe("a post ends at the tab bar even where the window reports itself shorter than the screen", () => {
  it("the gap is how far the screen (where fixed bars sit) runs past the window, never a bad reading", () => {
    // the iPhone home-screen app (iOS 26): the window reads 793pt on an 852pt screen, the tab bar at the screen's bottom
    expect(feedGap(852, 793)).toBe(59);
    expect(feedGap(852, 852)).toBe(0);
    // a fixed box shorter than the window (a browser toolbar mid-move) is no gap
    expect(feedGap(780, 793)).toBe(0);
    // anything bigger than a status bar's worth is a reading gone wrong, ignored
    expect(feedGap(793 + FEED_GAP_MAX + 1, 793)).toBe(0);
    expect(feedGap(Number.NaN, 793)).toBe(0);
  });

  it("is measured with the window's height and moves the post's bottom, words and buttons down by it", () => {
    const lib = read("src/lib/feed-paging.ts");
    expect(lib).toContain('root.style.setProperty("--feed-gap", `${feedGap(fixedScreenHeight(), vh)}px`);');
    expect(lib).toContain('probe.style.cssText = "position:fixed;top:0;bottom:0;left:0;width:0;visibility:hidden;pointer-events:none";');
    expect(lib).toContain('root.style.removeProperty("--feed-gap");');
    // the pages keep the window's height, so each swipe still lands on the next post
    expect(read("src/styles.css")).toContain("  height: calc(var(--feed-vh, 100svh) - var(--feed-page-top));");
  });
});

describe("the stories fold away as the first post comes up, and back in on the way down", () => {
  it("their progress follows the scroll exactly: 0 at the top, 1 once the first post is up", () => {
    expect(storiesProgress(0, 180)).toBe(0);
    expect(storiesProgress(90, 180)).toBe(0.5);
    expect(storiesProgress(400, 180)).toBe(1);
    expect(storiesProgress(-30, 180)).toBe(0); // iOS's rubber band at the top
  });

  it("the bubbles fold right to left, so they come back left to right, and all are gone before the post is up", () => {
    const right = 0.95;
    const left = 0.05;
    // part way up, the right one is further gone than the left one
    expect(bubbleFold(0.3, right)).toBeGreaterThan(bubbleFold(0.3, left));
    // on the way back down (the same p), the left one is back first
    expect(bubbleFold(0.35, left)).toBeLessThan(bubbleFold(0.35, right));
    // every bubble is gone two thirds of the way up (never half faded under the bar), and all there at the top
    expect(BUBBLE_WAVE + BUBBLE_FOLD_SPAN).toBeLessThanOrEqual(0.66);
    expect(bubbleFold(BUBBLE_WAVE + BUBBLE_FOLD_SPAN, 0)).toBe(1);
    expect(bubbleFold(1, 0)).toBe(1);
    expect(bubbleFold(0, 1)).toBe(0);
  });

  it("eases in and out (no jolt at either end)", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(0.1)).toBeLessThan(0.1);
  });

  it("is tied to the scroll and only writes styles while the top of the feed is moving", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("useStoriesMotion(pager, firstScreen, fold, firstKey);");
    expect(screen).toContain("if (last === 1 && window.scrollY >= end) return;");
    // the row sinks slower than the page, so the post slides up over it; its top corners square off
    expect(screen).toContain("`translate3d(0, ${(p * end * 0.4).toFixed(1)}px, 0)`");
    expect(screen).toContain("const r = `${(FIRST_POST_RADIUS * (1 - ease(p))).toFixed(1)}px`;");
    // reduced motion keeps the fade, without the movement
    expect(screen).toContain('row.style.transform = p <= 0 || reduce ? "" :');
  });

  it("under the stories the first post's picture sits right under them, not a bar's height lower, and eases to its place as it comes up (Nov 13 2026)", () => {
    const screen = read("src/components/community/community-screen.tsx");
    const css = read("src/styles.css");
    expect(screen).toContain("const u = reduce ? 0 : 1 - ease(p);");
    expect(screen).toContain('first.style.setProperty("--first-under", u.toFixed(3));');
    // once it's up nothing is left on it (a transform would trap a fixed child)
    expect(screen).toContain('first.removeAttribute("data-first-under");');
    // only a picture shown whole moves (a clip that fills its screen already starts at the post's top), never on a computer
    expect(css).toContain('[data-first-under] [data-post-hero]:not(:has([data-fit="cover"])) {');
    expect(css).toContain("transform: translate3d(0, calc(var(--first-under, 0) * min(0px, 8px - var(--feed-bar-room))), 0);");
  });
});
