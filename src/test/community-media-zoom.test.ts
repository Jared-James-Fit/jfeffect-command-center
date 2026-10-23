import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { panView, pinchView } from "@/hooks/use-media-pinch-zoom";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const hook = read("src/hooks/use-media-pinch-zoom.ts");
const screen = read("src/components/community/community-screen.tsx");
const card = read("src/components/community/post-card.tsx");
const comments = read("src/components/community/comments-sheet.tsx");
const shared = read("src/components/community/shared-comment.tsx");
const art = read("src/components/community/post-art.tsx");
const detail = read("src/components/community/post-detail.tsx");

describe("community zoom: the page stays put, media zooms", () => {
  it("the page never pinch- or double-tap-zooms", () => {
    expect(screen).toMatch(/useMediaPinchZoom\(true\);/);
    expect(screen).toMatch(/\[touch-action:pan-x_pan-y\]/);
    // iOS page pinch comes as gesture events; two-finger moves are held everywhere
    expect(hook).toMatch(/document\.addEventListener\("gesturestart", noGesture/);
    expect(hook).toMatch(/if \(zoom \|\| e\.touches\.length > 1\) \{\s*\/\/ two fingers never zoom or scroll the page\s*if \(e\.cancelable\) e\.preventDefault\(\);/);
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

  it("an automated post's painted picture zooms like a photo; its grid tile doesn't", () => {
    expect(art).toMatch(/<div data-pinch-zoom=\{zoom \? "" : undefined\} className="absolute inset-0">\s*<ArtImg/);
    expect(art).toMatch(/zoom = true,/);
    expect(art).toMatch(/<PostArtImage post=\{post\} card=\{card\} unit=\{unit\} fill zoom=\{false\} \/>/);
  });

  it("a post opened anywhere zooms, and nested managers share one set of listeners", () => {
    expect(detail).toMatch(/useMediaPinchZoom\(!!postId\);/);
    expect(hook).toMatch(/if \(holders\+\+ === 0\) uninstall = install\(\);/);
    expect(hook).toMatch(/if \(--holders > 0\) return;/);
  });

  it("lifting one finger keeps it zoomed and following that finger; it springs back only when every finger is off", () => {
    // a finger still down: start again from it, nothing springs back
    expect(hook).toMatch(/if \(e\.touches\.length > 0 && zoom\.view\.s >= HOLD_MIN_SCALE\) return rebase\(e\.touches\);\s*\/\/ no tap, double-tap like or link from letting go\s*if \(e\.cancelable\) e\.preventDefault\(\);\s*finish\(true\);/);
    // a second finger back down carries the pinch on from the size it has
    expect(hook).toMatch(/if \(zoom\) return rebase\(e\.touches\);/);
    expect(hook).toMatch(/document\.addEventListener\("touchend", onEnd, \{ passive: false \}\);/);
  });

  it("the picture's spot under the fingers stays under them, from whatever size it has", () => {
    const origin = { x: 0, y: 100 };
    // pinch from 1x on the middle of a 390 × 487.5 picture, fingers 60 → 180 apart: 3x, centre still under them
    const v1 = pinchView({ x: 0, y: 0, s: 1 }, origin, 60, { x: 195, y: 343.75 }, 180, { x: 195, y: 343.75 });
    expect(v1).toEqual({ s: 3, x: -390, y: -487.5 });
    // one finger left, dragged by (50, 60): same size, moved with it
    const v2 = panView(v1, { x: 105, y: 343.75 }, { x: 155, y: 403.75 });
    expect(v2).toEqual({ s: 3, x: -340, y: -427.5 });
    // a second finger back: the pinch goes on from 3x (60 → 80 apart is 4x) around the new midpoint
    const m = { x: 185, y: 403.75 };
    const v3 = pinchView(v2, origin, 60, m, 80, m);
    expect(v3.s).toBe(4);
    const local = (v: typeof v2) => ({ x: (m.x - origin.x - v.x) / v.s, y: (m.y - origin.y - v.y) / v.s });
    expect(local(v3).x).toBeCloseTo(local(v2).x, 6);
    expect(local(v3).y).toBeCloseTo(local(v2).y, 6);
    // never smaller than its place, never past 4x
    expect(pinchView(v2, origin, 100, m, 10, m).s).toBe(1);
    expect(pinchView(v2, origin, 10, m, 1000, m).s).toBe(4);
  });

  it("scrolling never waits on it", () => {
    expect(hook).toMatch(/document\.addEventListener\("touchstart", onStart, \{ passive: true \}\);/);
  });
});
