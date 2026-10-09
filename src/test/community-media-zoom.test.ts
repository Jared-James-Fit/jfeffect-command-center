import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const hook = read("src/hooks/use-media-pinch-zoom.ts");
const screen = read("src/components/community/community-screen.tsx");
const card = read("src/components/community/post-card.tsx");
const comments = read("src/components/community/comments-sheet.tsx");
const shared = read("src/components/community/shared-comment.tsx");

describe("community zoom: the page stays put, media zooms", () => {
  it("the page never pinch- or double-tap-zooms", () => {
    expect(screen).toMatch(/useMediaPinchZoom\(true\);/);
    expect(screen).toMatch(/\[touch-action:pan-x_pan-y\]/);
    // iOS page pinch comes as gesture events; two-finger moves are held everywhere
    expect(hook).toMatch(/document\.addEventListener\("gesturestart", noGesture/);
    expect(hook).toMatch(/if \(e\.touches\.length < 2\) return;\s*\/\/ two fingers never zoom or scroll the page\s*if \(e\.cancelable\) e\.preventDefault\(\);/);
    expect(hook).toMatch(/useNoAutoZoom\(active\);/);
  });

  it("only marked photos and videos zoom: lifted out, follow the fingers, spring back", () => {
    expect(hook).toMatch(/closest<HTMLElement>\("\[data-pinch-zoom\]"\)/);
    expect(hook).toMatch(/scale\(\$\{s\}\)/);
    expect(hook).toMatch(/const MAX_SCALE = 4;/);
    expect(hook).toMatch(/z\.clone\.style\.transform = "none";/);
    // a video that's playing keeps its own controls
    expect(hook).toMatch(/if \(playing && !playing\.paused\) return false;/);
  });

  it("feed / post / carousel media, comment photos and shared-comment media opt in", () => {
    expect(card).toMatch(/<div data-pinch-zoom className="absolute inset-0">/);
    expect(comments).toMatch(/data-pinch-zoom\s/);
    expect(shared).toMatch(/<div data-pinch-zoom /);
  });

  it("scrolling never waits on it", () => {
    expect(hook).toMatch(/document\.addEventListener\("touchstart", onStart, \{ passive: true \}\);/);
  });
});
