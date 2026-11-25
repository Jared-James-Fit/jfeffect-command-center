import { describe, expect, it } from "vitest";
import {
  CENTRED,
  POST_ASPECTS,
  POST_ASPECT_LABEL,
  clampFraming,
  closestAspect,
  framedStyle,
  isTurned,
  minTiltZoom,
  nextAspect,
  panFraming,
  quarterTurns,
  startAspect,
  straightenOf,
  tiltBox,
  turnQuarter,
  turnedPlacement,
  turnedSize,
  withStraighten,
} from "@/lib/photo-frame";

const photo = { w: 4032, h: 3024 }; // an iPhone photo held sideways
const frame = { w: 9 / 16, h: 1 };

/** Every corner of the frame lands inside the photo (no empty corner), from the placement's own numbers. */
function covers(f: Parameters<typeof clampFraming>[0], img = photo, box = { w: 900, h: 1600 }) {
  const t = turnedPlacement(f, img, box);
  const a = (t.deg * Math.PI) / 180;
  const corners = [
    [0, 0],
    [box.w, 0],
    [0, box.h],
    [box.w, box.h],
  ];
  return corners.every(([x, y]) => {
    // screen → the photo's own px (undo translate, rotate, translate)
    const dx = x - t.tx;
    const dy = y - t.ty;
    const lx = dx * Math.cos(-a) - dy * Math.sin(-a) + t.ox;
    const ly = dx * Math.sin(-a) + dy * Math.cos(-a) + t.oy;
    return lx >= -0.5 && ly >= -0.5 && lx <= t.w + 0.5 && ly <= t.h + 0.5;
  });
}

describe("a post's shapes", () => {
  it("3:4 joins 9:16, 4:5, 1:1 and 16:9 under the shape button, never as a starting shape", () => {
    expect(POST_ASPECTS.classic).toBeCloseTo(0.75);
    expect(POST_ASPECT_LABEL.classic).toBe("3:4");
    expect(nextAspect("portrait")).toBe("classic");
    expect(nextAspect("classic")).toBe("square");
    expect(nextAspect("landscape")).toBe("full");
    expect(closestAspect(3024, 4032)).toBe("portrait");
    expect(startAspect(3024, 4032)).toBe("full");
  });
});

describe("turning and straightening a photo (kept whole, drawn turned only when posted)", () => {
  it("quarter turns and the straighten read apart", () => {
    expect(quarterTurns(90)).toBe(1);
    expect(quarterTurns(-90)).toBe(3);
    expect(quarterTurns(370)).toBe(0);
    expect(straightenOf(97)).toBeCloseTo(7);
    expect(straightenOf(-12)).toBeCloseTo(-12);
    expect(turnedSize(photo, 90)).toEqual({ w: 3024, h: 4032 });
    expect(turnedSize(photo, 180)).toEqual(photo);
  });
  it("a framing from before (no turn) is untouched", () => {
    expect(clampFraming(CENTRED, photo, frame)).toEqual(CENTRED);
    expect(isTurned(CENTRED)).toBe(false);
    expect(isTurned({ ...CENTRED, r: 360 })).toBe(false);
    expect(framedStyle(CENTRED, photo, { w: 900, h: 1600 }).transformOrigin).toBeUndefined();
  });
  it("a turn starts centred and filling; four turns come back round", () => {
    let f = turnQuarter(CENTRED);
    expect(f).toEqual({ z: 1, cx: 0.5, cy: 0.5, r: 90 });
    f = turnQuarter(turnQuarter(turnQuarter(f)));
    expect(quarterTurns(f.r)).toBe(0);
  });
  it("straightening zooms in just enough that no corner goes empty, at any tilt and while it's moved", () => {
    for (const deg of [-45, -20, -3, 3, 12, 30, 45]) {
      const f = clampFraming(withStraighten(CENTRED, deg), photo, frame);
      expect(f.z).toBeGreaterThanOrEqual(minTiltZoom(photo, frame, deg) - 1e-9);
      expect(covers(f)).toBe(true);
      // dragged hard to a corner, still covered
      const moved = panFraming(f, 5000, -5000, photo, frame);
      expect(covers(moved)).toBe(true);
    }
    expect(tiltBox({ w: 1, h: 1 }, 0)).toEqual({ w: 1, h: 1 });
    expect(minTiltZoom(photo, frame, 0)).toBe(1);
  });
  it("turned a quarter, the photo stands upright and fills the frame", () => {
    const f = clampFraming(turnQuarter(CENTRED), photo, frame);
    expect(covers(f)).toBe(true);
    const t = turnedPlacement(f, photo, { w: 900, h: 1600 });
    expect(t.deg).toBe(90);
    // the sideways photo's width now runs down the frame (its full height), its height across (at least the width)
    expect(t.w).toBeCloseTo(1600, 0);
    expect(t.h).toBeGreaterThanOrEqual(900);
  });
  it("the straighten slider keeps the quarter turns; 0 with none is no turn at all", () => {
    expect(withStraighten({ ...CENTRED, r: 90 }, 5).r).toBe(95);
    expect(withStraighten({ ...CENTRED, r: 5 }, 0).r).toBeUndefined();
    expect(withStraighten(CENTRED, 80).r).toBe(45);
  });
});
