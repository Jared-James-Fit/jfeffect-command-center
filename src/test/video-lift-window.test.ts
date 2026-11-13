import { describe, expect, it } from "vitest";
import { LIFT_PAD_AFTER, LIFT_PAD_BEFORE, classifyMoments, liftWindow, liftZone, motionMasks, type LiftFrame } from "@/lib/video-edit/lift-window";

// a phone's portrait picture, tiny: 36 × 64
const W = 36;
const H = 64;
type Rect = { x: number; y: number; w: number; h: number };

/** A gym: a textured background (shifted when the phone moves), a dark lifter, brighter overall when the phone re-exposes. */
function frame(t: number, person: Rect | null, opts: { shift?: number; bright?: number } = {}): LiftFrame {
  const px = new Uint8Array(W * H);
  const shift = opts.shift ?? 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // a busy gym wall: no two neighbours alike, so a moved phone changes nearly every pixel
      let v = 70 + (((((x + shift) * 73856093) ^ (y * 19349663)) >>> 0) % 110) + (opts.bright ?? 0);
      if (person && x >= person.x && x < person.x + person.w && y >= person.y && y < person.y + person.h) v = 20;
      px[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { t, px };
}

/** At the bar, standing (top of a rep) or down (the bottom): the bar zone around x 14–22, y 28–48. */
const atBar = (down: boolean, jitter = 0): Rect => ({ x: 14 + jitter, y: down ? 34 : 28, w: 8, h: down ? 14 : 20 });

/**
 * A set filmed the way it's filmed: press record and walk from the phone to
 * the bar (big, close to the lens, then smaller), set up, eight reps, rack and
 * stand, walk back to the phone (growing), pick the phone up. One frame a
 * second, like a phone's keyframes.
 */
function setClip(): { frames: LiftFrame[]; duration: number; lift: { from: number; to: number } } {
  const f: LiftFrame[] = [];
  // walking away from the phone, 0–3 s
  f.push(frame(0, { x: 0, y: 0, w: 34, h: 64 }));
  f.push(frame(1, { x: 4, y: 8, w: 22, h: 48 }));
  f.push(frame(2, { x: 9, y: 20, w: 14, h: 32 }));
  // at the bar: setting up, 3–8 s (a shuffle, a breath)
  f.push(frame(3, atBar(false, 1)));
  f.push(frame(4, atBar(false, 0)));
  f.push(frame(5, atBar(false, 1)));
  f.push(frame(6, atBar(false, 1)));
  f.push(frame(7, atBar(false, 0)));
  // eight reps, 8–24 s
  for (let t = 8; t <= 24; t++) f.push(frame(t, atBar(t % 2 === 1)));
  // racked, standing, 25–26 s
  f.push(frame(25, atBar(false, 1)));
  f.push(frame(26, atBar(false, 1)));
  // walking back to the phone, 27–30 s
  f.push(frame(27, { x: 9, y: 20, w: 14, h: 32 }));
  f.push(frame(28, { x: 4, y: 8, w: 22, h: 48 }));
  f.push(frame(29, { x: 0, y: 0, w: 34, h: 64 }));
  // the phone picked up
  f.push(frame(30, null, { shift: 9 }));
  f.push(frame(31, null, { shift: 17 }));
  return { frames: f, duration: 31.5, lift: { from: 3, to: 26 } };
}

describe("finding the lift in a filmed set", () => {
  it("keeps the set, from stepping up to the bar to racking it, and cuts the walks and the phone being picked up", () => {
    const { frames, duration } = setClip();
    const win = liftWindow(frames, W, H, duration);
    expect(win).not.toBeNull();
    // starts as they reach the bar (a moment before), never in the middle of the walk away from the lens
    expect(win!.start).toBeGreaterThanOrEqual(1.5);
    expect(win!.start).toBeLessThanOrEqual(3);
    // every rep is in
    expect(win!.start).toBeLessThan(8);
    expect(win!.end).toBeGreaterThan(24);
    // the walk back and the phone are out
    expect(win!.end).toBeLessThanOrEqual(28.5);
  });

  it("knows the bar's spot from where the movement keeps coming back to (each moment counts once, so a walk past the lens can't outweigh the reps)", () => {
    const { frames } = setClip();
    const zone = liftZone(motionMasks(frames), W, H)!;
    expect(zone.x0).toBeGreaterThanOrEqual(10);
    expect(zone.x1).toBeLessThanOrEqual(26);
    expect(zone.y0).toBeGreaterThanOrEqual(22);
    expect(zone.y1).toBeLessThanOrEqual(52);
    const kinds = classifyMoments(motionMasks(frames), W, H, zone).map((m) => m.kind);
    // the walk away is off the bar, the reps are the lift, picking the phone up is the phone
    expect(kinds[0]).toBe("off");
    expect(kinds.slice(9, 20).every((k) => k === "lift")).toBe(true);
    expect(kinds[kinds.length - 1]).toBe("phone");
  });

  it("pads a moment either side so the unrack and the rack are never cut", () => {
    expect(LIFT_PAD_BEFORE).toBeGreaterThan(0);
    expect(LIFT_PAD_AFTER).toBeGreaterThan(LIFT_PAD_BEFORE);
  });

  it("cuts a phone left running before and after: nothing happening for seconds either side", () => {
    const f: LiftFrame[] = [];
    for (let t = 0; t < 6; t++) f.push(frame(t, null));
    for (let t = 6; t <= 18; t++) f.push(frame(t, atBar(t % 2 === 1)));
    for (let t = 19; t < 26; t++) f.push(frame(t, null));
    const win = liftWindow(f, W, H, 26)!;
    expect(win).not.toBeNull();
    expect(win.start).toBeGreaterThanOrEqual(4);
    expect(win.start).toBeLessThanOrEqual(6);
    expect(win.end).toBeGreaterThanOrEqual(18);
    expect(win.end).toBeLessThanOrEqual(21);
  });

  it("says nothing when the clip is already just the lift (nothing worth cutting)", () => {
    const f: LiftFrame[] = [];
    for (let t = 0; t <= 20; t++) f.push(frame(t, atBar(t % 2 === 1)));
    expect(liftWindow(f, W, H, 20.5)).toBeNull();
  });

  it("says nothing for a handheld clip (the whole picture moves every second) or a clip with nothing going on", () => {
    const shaky: LiftFrame[] = [];
    for (let t = 0; t <= 20; t++) shaky.push(frame(t, atBar(t % 2 === 1), { shift: (t * 5) % 11 }));
    expect(liftWindow(shaky, W, H, 20.5)).toBeNull();
    const empty: LiftFrame[] = [];
    for (let t = 0; t <= 20; t++) empty.push(frame(t, null));
    expect(liftWindow(empty, W, H, 20.5)).toBeNull();
    expect(liftWindow([], W, H, 10)).toBeNull();
  });

  it("the phone re-exposing (the whole picture a bit brighter) is not movement", () => {
    const a = frame(0, null);
    const b = frame(1, null, { bright: 30 });
    expect(motionMasks([a, b])[0].count).toBe(0);
  });
});
