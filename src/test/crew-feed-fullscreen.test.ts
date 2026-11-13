import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUBBLE_FOLD_SPAN, BUBBLE_WAVE, bubbleFold, ease, storiesProgress } from "@/lib/feed-paging";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("every post fills the screen, TikTok's way", () => {
  const css = read("src/styles.css");
  const card = read("src/components/community/post-card.tsx");

  it("a screen is the window's measured height, read again only on a rotation (never a toolbar or the keyboard)", () => {
    const lib = read("src/lib/feed-paging.ts");
    expect(lib).toContain('root.style.setProperty("--feed-vh", `${Math.round(window.innerHeight)}px`);');
    expect(lib).toContain("if (window.innerWidth === width) return;");
    expect(read("src/components/community/community-screen.tsx")).toContain("const unwatch = watchFeedViewport();");
  });

  it("each post fills the screen down to the tab bar, Crew's bar floating over its top", () => {
    expect(css).toContain("  --feed-bar-room: 3rem;\n  --feed-nav-room: var(--mobile-bar-top);");
    // the post itself runs from under the status bar down to the tab bar (opaque, TikTok's)
    expect(card).toContain('style={{ top: -raise, bottom: sheetOpen ? POST_SHEET_HEIGHT : "var(--feed-nav-room)" }}');
    // a picture shown whole sits between the bars; a clip that fills the screen runs under both
    expect(card).toContain('const BETWEEN_BARS = { top: "var(--feed-bar-room)" } as const;');
    expect(card).toContain("<FitBox ratio={0.8} page>");
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain('const between = controls === "top" && fit === "contain";');
    // what sits at the top of a post (the set's caption, "2/4", the speaker) moves down under the bar
    expect(card).toContain('style={top ? { paddingTop: "calc(var(--feed-bar-room, 0px) + 0.75rem)" } : undefined}');
    expect(card).toContain('page ? "top-[calc(var(--feed-bar-room)+0.625rem)]" : "top-2.5"');
    // a post with its sheet open has nothing floating over it
    expect(css).toContain("[data-sheet-open] { --feed-bar-room: 0px; --feed-nav-room: 0px; }");
  });

  it("the words and the buttons down the right sit just above the tab bar (nothing stands over the bar any more)", () => {
    expect(css).toContain("  --feed-words-bottom: calc(var(--mobile-bar-top) + 12px);");
    expect(css).toContain("  --feed-actions-bottom: calc(var(--mobile-bar-top) + 8px);");
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
});
