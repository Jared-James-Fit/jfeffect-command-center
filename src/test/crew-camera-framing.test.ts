import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCK_SLIDE_PX, ZOOM_DEAD_PX, slideLocks, zoomFromPinch, zoomFromSlide, zoomLabel, zoomRange, type ZoomRange } from "@/lib/camera/camera-zoom";
import { studioCameraAsk } from "@/lib/camera/camera-prime";

/**
 * The Crew camera (Nov 23 2026): a story's camera is 9:16 and what's shot or
 * filmed is exactly what the viewfinder showed; the camera's own zoom by
 * pinching or sliding up while filming; slide left to lock a clip.
 */
const read = (p: string) => readFileSync(p, "utf8");
const studio = read("src/components/community/share-studio.tsx");

describe("the story camera asks for a 9:16 picture", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("a phone held upright asks 1080p at 9:16 (one way round or the other), never the old 4:3", () => {
    const mm = (q: string) => ({ matches: q.includes("coarse"), addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("screen", { width: 390, height: 844, orientation: { type: "portrait-primary", angle: 0 } });
    vi.stubGlobal("window", { matchMedia: mm, orientation: 0 });
    const ask = studioCameraAsk("environment", "portrait");
    expect(ask.width).toEqual({ ideal: 1080 });
    expect(ask.height).toEqual({ ideal: 1920 });
    const other = studioCameraAsk("environment", "landscape");
    expect(other.width).toEqual({ ideal: 1920 });
    expect(other.height).toEqual({ ideal: 1080 });
  });
  it("a tablet or computer keeps the 4:3 ask (a landscape webcam keeps more of its height under the 9:16 crop)", () => {
    vi.stubGlobal("screen", { width: 1440, height: 900, orientation: { type: "landscape-primary", angle: 0 } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), orientation: 0 });
    expect(studioCameraAsk("user")).toEqual({ facingMode: { ideal: "user" }, width: { ideal: 1920 }, height: { ideal: 1440 } });
  });
  it("checks the picture it got, asks the other way once, and remembers what worked (the set camera's rule)", () => {
    expect(studio).toContain("const pic = await pictureSize(video, PICTURE_WAIT_MS);");
    expect(studio).toContain("if (pic) saveFilmAsk(shapes[0]);");
    expect(studio).toContain("const other = await reopen(shapes[1]);");
    expect(studio).toContain("if (pictureFits(pic2.w, pic2.h, upright)) saveFilmAsk(shapes[1]);");
    // the closer one when neither is 9:16: never no camera because of the shape
    expect(studio).toContain("return reopen(shapes[0]);");
  });
  it("a shot or a clip from the camera starts framed exactly as the viewfinder showed it", () => {
    // a camera photo never starts "whole" over a blur on a story
    expect(studio).toContain("setShotWhole(story && !reply && !share && !s.live && storyStartsWhole(drawableSize(s.src as Drawable)));");
    // a clip: filling the story, framed by the camera's guide on a post (never re-decided from its 3:4 shape)
    expect(studio).toContain("const place = { whole: false, framing: !v || story ? CENTRED : framingFromGuide({ w: v.w, h: v.h }, v.view, v.guide) };");
    expect(read("src/components/community/slide-tray.tsx")).toContain("async (files: File[], place?: { framing?: Framing | null; whole?: boolean }) => {");
  });
  it("the viewfinder shows once it's measured (no box that jumps to full screen), and a flip holds the last frame", () => {
    expect(studio).toContain('visibility: phase === "shoot" && !measured ? "hidden" : undefined');
    expect(studio).toContain("data-camera-still");
    expect(studio).toContain("holdStill();");
  });
});

describe("zoom: the camera's own, never a fake crop", () => {
  const r: ZoomRange = { min: 1, max: 8, now: 1 };
  it("is offered only when the track has a zoom range", () => {
    const track = (caps: unknown, zoom?: number) => ({ getCapabilities: () => caps, getSettings: () => ({ zoom }) }) as unknown as MediaStreamTrack;
    expect(zoomRange(track({}))).toBeNull();
    expect(zoomRange(track({ zoom: { min: 1, max: 1 } }))).toBeNull();
    expect(zoomRange(track({ zoom: { min: 1, max: 30 } }, 2))).toEqual({ min: 1, max: 10, now: 2 });
    expect(zoomRange(null)).toBeNull();
  });
  it("sliding up while filming zooms in, down zooms back out, a wobble does nothing", () => {
    expect(zoomFromSlide(1, -(ZOOM_DEAD_PX - 1), r)).toBe(1);
    const up = zoomFromSlide(1, -200, r);
    expect(up).toBeGreaterThan(1.5);
    expect(zoomFromSlide(1, -2000, r)).toBe(8);
    expect(zoomFromSlide(4, 2000, r)).toBe(1);
    expect(zoomFromSlide(up, 0, r)).toBe(up);
  });
  it("a pinch follows the fingers, held to the range", () => {
    expect(zoomFromPinch(1, 100, 200, r)).toBe(2);
    expect(zoomFromPinch(2, 200, 100, r)).toBe(1);
    expect(zoomFromPinch(1, 100, 5000, r)).toBe(8);
  });
  it("says the zoom only past the widest", () => {
    expect(zoomLabel(1, r)).toBeNull();
    expect(zoomLabel(2.4, r)).toBe("2.4×");
    expect(zoomLabel(2, null)).toBeNull();
  });
});

describe("hold to film, slide left to lock", () => {
  it("locks only on a clear slide to the left", () => {
    expect(slideLocks(-LOCK_SLIDE_PX - 1, 4)).toBe(true);
    expect(slideLocks(-30, 0)).toBe(false);
    expect(slideLocks(-LOCK_SLIDE_PX - 10, -200)).toBe(false); // mostly up: that's a zoom
    expect(slideLocks(LOCK_SLIDE_PX + 10, 0)).toBe(false);
  });
  it("the shutter keeps the finger while it films: zoom and lock from the same hold; locked, a lift keeps filming", () => {
    const carousel = read("src/components/community/look-carousel.tsx");
    expect(carousel).toContain("if (held.current && !lockedHere.current) holdRef.current?.onEnd();");
    expect(carousel).toContain("handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },");
    expect(studio).toContain("onSlide: zoomCaps ? (_dx, dy) => applyZoom(zoomFromSlide(slideFrom.current, dy, zoomCaps)) : undefined,");
    expect(studio).toContain("onLock: recorder.lock,");
    expect(read("src/components/community/clip-recorder.ts")).toContain("const lock = useCallback(() => {");
  });
  it("the camera takes every finger: a pinch zooms, never a look swipe or a flip", () => {
    expect(studio).toContain('phase === "shoot" ? "touch-none" : "touch-pan-y"');
    expect(studio).toContain("if (!st || pinched.current) return;");
  });
});
