import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IOS_GAP_SLACK, iosBottomGap, type BottomGapReading } from "@/lib/ios-edge";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// the coach's iPhone home-screen app (old install, transparent status bar), Nov 2026
const coach: BottomGapReading = { standalone: true, topInset: 59, screenW: 393, screenH: 852, windowW: 393, fixedH: 793 };

describe("the iPhone home-screen app laying fixed things out a status bar short", () => {
  it("reads the gap: fixed things end 59pt above the real bottom (the tab bar rode up with a band under it)", () => {
    expect(iosBottomGap(coach)).toBe(59);
  });

  it("the normal layout (fixed things reach the screen's bottom) needs nothing", () => {
    expect(iosBottomGap({ ...coach, fixedH: 852 })).toBe(0);
  });

  it("never with a solid status bar: the page starts under the clock, its bottom is the screen's", () => {
    expect(iosBottomGap({ ...coach, topInset: 0, fixedH: 793 })).toBe(0);
  });

  it("never in a browser, on a tablet or on its side", () => {
    expect(iosBottomGap({ ...coach, standalone: false })).toBe(0);
    expect(iosBottomGap({ ...coach, screenW: 820, screenH: 1180, windowW: 820, fixedH: 1121, topInset: 24 })).toBe(0);
    expect(iosBottomGap({ ...coach, windowW: 852, fixedH: 393 })).toBe(0);
  });

  it("never more than about the status bar's height (a keyboard, a bad reading)", () => {
    expect(iosBottomGap({ ...coach, fixedH: 852 - 59 - IOS_GAP_SLACK })).toBe(59 + IOS_GAP_SLACK);
    expect(iosBottomGap({ ...coach, fixedH: 852 - 59 - IOS_GAP_SLACK - 1 })).toBe(0);
    expect(iosBottomGap({ ...coach, fixedH: 500 })).toBe(0);
    expect(iosBottomGap({ ...coach, fixedH: 900 })).toBe(0);
    expect(iosBottomGap({ ...coach, screenW: 0, screenH: 0 })).toBe(0);
  });
});

describe("what's pinned to the bottom goes back down, and the tab bar's room shrinks by as much", () => {
  const css = read("styles.css");
  it("moves bottom-pinned and full-screen layers to the real bottom, never while typing", () => {
    expect(css).toContain('html[data-ios-bottom-gap]:not([data-keyboard-open="true"]) .fixed.bottom-0');
    expect(css).toContain('html[data-ios-bottom-gap]:not([data-keyboard-open="true"]) .fixed.inset-0,');
    expect(css).toContain("bottom: calc(-1 * var(--ios-bottom-gap, 0px));");
    expect(css).toContain(".fixed.inset-0.h-\\[100dvh\\]");
    expect(css).toContain("height: calc(100dvh + var(--ios-bottom-gap, 0px));");
  });

  it("measures the tab bar's room from the short edge, so pages, chats and Crew still end at the bar", () => {
    expect(css).toContain("--mobile-bar-top: max(0px, calc(var(--mobile-bar-h) + env(safe-area-inset-bottom, 0px) - var(--ios-bottom-shift, 0px)));");
    expect(css).toContain("--feed-nav-room: max(0px, calc(var(--mobile-bar-top) - var(--feed-gap, 0px)));");
  });

  it("is watched from the app shell with a persistent probe, so it follows iOS flipping layouts", () => {
    const edge = read("lib/ios-edge.ts");
    expect(edge).toContain("new ResizeObserver(measure)");
    expect(edge).toContain('if (!root.hasAttribute("data-ios-web-app")) return () => {};');
    expect(read("components/app-shell.tsx")).toContain("useEffect(() => watchIosBottomGap(), []);");
  });
});
