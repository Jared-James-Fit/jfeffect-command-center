import { describe, expect, it } from "vitest";
import { LM, READY, advanceStep, eyeBandIn, eyesClosed, faceCrop, faceMetrics, guidance, serverWouldRefuse, type Pt, type StepState } from "@/lib/headshots/face-geometry";

/** A frontal face's landmarks (normalised), with the few points the geometry reads placed on purpose. */
function face(o: { cx?: number; cy?: number; h?: number; turn?: number; tilt?: number; eyeOpen?: number } = {}): Pt[] {
  const cx = o.cx ?? 0.5;
  const cy = o.cy ?? 0.48;
  const h = o.h ?? 0.5;
  const w = h * 0.75;
  const pts: Pt[] = Array.from({ length: 478 }, (_, i) => {
    // a ring of points on the face's outline, so the box is the face
    const a = (i / 478) * Math.PI * 2;
    return { x: cx + Math.cos(a) * (w / 2), y: cy + Math.sin(a) * (h / 2) };
  });
  const turn = o.turn ?? 0; // share of half-width the nose moves (+ = the person's left = frame right)
  const tilt = o.tilt ?? 0; // frame-y offset of the frame-right eye
  const eyeY = cy - h * 0.1;
  const open = (o.eyeOpen ?? 0.3) * (w * 0.18);
  pts[LM.edgeL] = { x: cx - w / 2, y: cy };
  pts[LM.edgeR] = { x: cx + w / 2, y: cy };
  pts[LM.noseTip] = { x: cx + turn * (w / 2), y: cy + h * 0.08 };
  pts[LM.forehead] = { x: cx, y: cy - h / 2 };
  pts[LM.chin] = { x: cx, y: cy + h / 2 };
  const eye = (xc: number, yc: number, ids: { outer: number; inner: number; upper: number; lower: number }, outerLeft: boolean) => {
    pts[ids.outer] = { x: outerLeft ? xc - w * 0.09 : xc + w * 0.09, y: yc };
    pts[ids.inner] = { x: outerLeft ? xc + w * 0.09 : xc - w * 0.09, y: yc };
    pts[ids.upper] = { x: xc, y: yc - open / 2 };
    pts[ids.lower] = { x: xc, y: yc + open / 2 };
  };
  eye(cx - w * 0.2, eyeY, LM.eyeL, true);
  eye(cx + w * 0.2, eyeY + tilt, LM.eyeR, false);
  return pts;
}

const W = 960;
const H = 1280;

describe("face geometry", () => {
  it("reads a straight-on face as level", () => {
    const m = faceMetrics(face(), W, H)!;
    expect(Math.abs(m.yaw)).toBeLessThan(1);
    expect(Math.abs(m.roll)).toBeLessThan(1);
    expect(m.share).toBeCloseTo(0.5, 2);
    expect(m.noseRatio).toBeGreaterThan(READY.noseRatio[0]);
    expect(m.noseRatio).toBeLessThan(READY.noseRatio[1]);
  });
  it("reads a turn to the person's own left as positive yaw (the frame isn't mirrored)", () => {
    expect(faceMetrics(face({ turn: 0.4 }), W, H)!.yaw).toBeGreaterThan(15);
    expect(faceMetrics(face({ turn: -0.4 }), W, H)!.yaw).toBeLessThan(-15);
  });
  it("reads a tilted head as roll", () => {
    expect(Math.abs(faceMetrics(face({ tilt: 0.05 }), W, H)!.roll)).toBeGreaterThan(12);
  });
  it("needs the whole mesh", () => {
    expect(faceMetrics(face().slice(0, 100), W, H)).toBeNull();
  });
  it("crops a square around the face, inside the frame", () => {
    const m = faceMetrics(face({ cx: 0.15 }), W, H)!;
    const c = faceCrop(m, W, H);
    expect(c.sx).toBeGreaterThanOrEqual(0);
    expect(c.sx + c.side).toBeLessThanOrEqual(W);
    expect(c.sy + c.side).toBeLessThanOrEqual(H);
    expect(c.side).toBeLessThanOrEqual(Math.min(W, H));
    const band = eyeBandIn(face(), faceCrop(faceMetrics(face(), W, H)!, W, H), H);
    expect(band.eyeTop).toBeLessThan(band.eyeBottom);
    expect(band.eyeTop).toBeGreaterThan(0.2);
    expect(band.eyeBottom).toBeLessThan(0.6);
  });
});

describe("guidance", () => {
  const good = { mean: 140, std: 45, sharpness: 200 };
  const m = faceMetrics(face(), W, H)!;
  it("is ready when one face is centred, near enough, lit, sharp and straight", () => {
    expect(guidance({ faces: 1, metrics: m, stats: good, eyeShade: 0.7 })).toEqual({ ready: true, hint: "Hold still" });
  });
  it("asks for one thing at a time, the most important first", () => {
    expect(guidance({ faces: 0, metrics: null, stats: null, eyeShade: null }).hint).toBe("Look at the camera");
    expect(guidance({ faces: 2, metrics: m, stats: good, eyeShade: 0.7 }).hint).toBe("Only you in the frame, please");
    expect(guidance({ faces: 1, metrics: faceMetrics(face({ h: 0.2 }), W, H), stats: good, eyeShade: 0.7 }).hint).toBe("Move a little closer");
    expect(guidance({ faces: 1, metrics: faceMetrics(face({ h: 0.9 }), W, H), stats: good, eyeShade: 0.7 }).hint).toBe("Move back a little");
    expect(guidance({ faces: 1, metrics: faceMetrics(face({ cx: 0.68 }), W, H), stats: good, eyeShade: 0.7 }).hint).toBe("Centre your face in the oval");
    expect(guidance({ faces: 1, metrics: m, stats: { ...good, mean: 40 }, eyeShade: 0.7 }).hint).toMatch(/more light/);
    expect(guidance({ faces: 1, metrics: faceMetrics(face({ turn: 0.4 }), W, H), stats: good, eyeShade: 0.7 }).hint).toBe("Look straight at the camera");
    expect(guidance({ faces: 1, metrics: m, stats: good, eyeShade: 0.2 }).hint).toMatch(/sunglasses/);
    expect(guidance({ faces: 1, metrics: m, stats: { ...good, sharpness: 10 }, eyeShade: 0.7 }).hint).toBe("Hold still");
  });
  it("never sends what the server would refuse", () => {
    expect(serverWouldRefuse({ mean: 20, std: 40 })).toBe(true);
    expect(serverWouldRefuse({ mean: 130, std: 40 })).toBe(false);
    expect(serverWouldRefuse(null)).toBe(true);
  });
});

describe("the challenge", () => {
  const start = (step: StepState["step"]): StepState => ({ step, startedAt: 0, peak: 0, captured: false, done: false });
  it("keeps the frame with the eyes closed, and finishes once they open", () => {
    let st = start("blink");
    let r = advanceStep(st, { yaw: 0, closed: false, closure: 0.1 });
    expect(r.keepFrame).toBe(false);
    r = advanceStep(r.state, { yaw: 0, closed: true, closure: 0.7 });
    expect(r.keepFrame).toBe(true);
    r = advanceStep(r.state, { yaw: 0, closed: true, closure: 0.6 });
    expect(r.keepFrame).toBe(false);
    r = advanceStep(r.state, { yaw: 0, closed: false, closure: 0.1 });
    expect(r.state.done).toBe(true);
    expect(r.state.peak).toBeCloseTo(0.7);
    st = r.state;
    expect(advanceStep(st, { yaw: 0, closed: true, closure: 1 }).keepFrame).toBe(false);
  });
  it("only counts a turn the way it asked, and finishes when they face the camera again", () => {
    let r = advanceStep(start("turn_left"), { yaw: -25, closed: false, closure: 0 });
    expect(r.state.captured).toBe(false);
    r = advanceStep(r.state, { yaw: 18, closed: false, closure: 0 });
    expect(r.keepFrame).toBe(true);
    r = advanceStep(r.state, { yaw: 24, closed: false, closure: 0 });
    expect(r.keepFrame).toBe(true);
    expect(r.state.peak).toBe(24);
    r = advanceStep(r.state, { yaw: 3, closed: false, closure: 0 });
    expect(r.state.done).toBe(true);
    const right = advanceStep(start("turn_right"), { yaw: -20, closed: false, closure: 0 });
    expect(right.keepFrame).toBe(true);
    expect(right.state.peak).toBe(-20);
  });
  it("reads a blink from the model's scores, or from the eyes against their open size", () => {
    expect(eyesClosed({ left: 0.8, right: 0.7 }, 0.3, 0.3)).toBe(true);
    expect(eyesClosed({ left: 0.8, right: 0.2 }, 0.3, 0.3)).toBe(false);
    expect(eyesClosed(null, 0.1, 0.3)).toBe(true);
    expect(eyesClosed(null, 0.25, 0.3)).toBe(false);
  });
});
