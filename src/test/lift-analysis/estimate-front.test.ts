/**
 * The any-angle estimate (estimate.ts) on a clip with a known answer: a squat
 * filmed from the front, where the plates are seen edge-on (a dark upright
 * block, never a circle), which the plate engine can't read. The plates' height
 * is the ruler (450 mm at any yaw), so the speed is an estimate and labelled one.
 */
import { describe, expect, it } from "vitest";
import { BLEND_FROM, candidatesDisagree, estimateRead, plateSize } from "@/lib/lift-analysis/estimate";
import { movementOf } from "@/lib/lift-analysis/exercise";
import type { Frame } from "@/lib/lift-analysis/image";
import { interp, squatSet, trajectory, type Scene } from "./synthetic";

function frontOnSquat(reps: number, seed = 3) {
  const W = 270;
  const H = 480;
  const plateMm = 450;
  const platePx = 80; // the plates' height on screen
  const mmPerPx = plateMm / platePx;
  const scene: Scene = {
    w: W,
    h: H,
    fps: 30,
    plateDiameterPx: platePx,
    x0: 0,
    y0: 0,
    phases: squatSet({ reps, rom: 560, down: 1.4, up: 1.1, pause: 0.15, gradual: true }),
    seed,
  };
  const truth = trajectory(scene);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const frames: Frame[] = [];
  const top = 150; // the bar's height on screen at the top of the rep
  const end = truth.t[truth.t.length - 1];
  for (let k = 0; k / scene.fps < end - 0.02; k++) {
    const t = k / scene.fps;
    const px = new Uint8Array(W * H);
    for (let i = 0; i < px.length; i++) px[i] = 150 + Math.round((rand() - 0.5) * 8);
    // a floor line and a rack upright: edges that never move
    for (let x = 0; x < W; x++) for (let y = 420; y < 424; y++) px[y * W + x] = 90;
    for (let y = 40; y < 420; y++) for (let x = 6; x < 12; x++) px[y * W + x] = 110;
    // the lifter and the bar: two edge-on plate stacks either side, moving with the bar
    const cy = top - interp(truth.y, truth.t, t) / mmPerPx;
    for (const cx of [60, 210]) {
      for (let y = Math.round(cy - platePx / 2); y < cy + platePx / 2; y++)
        for (let x = cx - 9; x <= cx + 9; x++)
          if (y >= 0 && y < H && x >= 0 && x < W) px[y * W + x] = 28 + Math.round(rand() * 6);
    }
    for (let y = Math.round(cy - 2); y <= cy + 2; y++) for (let x = 70; x < 200; x++) if (y >= 0 && y < H) px[y * W + x] = 70;
    frames.push({ w: W, h: H, px, t });
  }
  return { frames, truth };
}

describe("estimate: front-on plates (edge-on stacks)", { timeout: 90_000 }, () => {
  it("reads every rep and an estimated set speed close to the truth", () => {
    const { frames, truth } = frontOnSquat(3);
    const res = estimateRead(frames, { movement: movementOf("Competition Squat"), expectedReps: 3, dirHint: "lower_first" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a = res.analysis;
    expect(a.reps.length).toBe(3);
    expect(a.plate.view).toBe("front");
    expect(a.velocity?.accepted).toBe(true);
    expect(a.velocity?.tier).toBe("estimated");
    expect(a.quality.notes).toContain("estimated_track");
    const truthMcv = truth.reps.reduce((s, r) => s + r.mcv, 0) / truth.reps.length / 1000; // mm/s → m/s
    expect(Math.abs((a.velocity!.value as number) - truthMcv) / truthMcv).toBeLessThan(0.12);
  });

  it("never reads a set whose reps don't match the logged reps", () => {
    const { frames } = frontOnSquat(3, 9);
    const res = estimateRead(frames, { movement: movementOf("Competition Squat"), expectedReps: 6, dirHint: "lower_first" });
    expect(res.ok).toBe(false);
  });

  it("never guesses a movement it can't name", () => {
    const { frames } = frontOnSquat(2, 5);
    const res = estimateRead(frames, { movement: movementOf("Mystery lift"), expectedReps: 2 });
    expect(res.ok).toBe(false);
  });
});

describe("the plate's size from its two measurements", () => {
  const seed = { hw: 15, hh: 18 };
  const edges = (b: number) => ({ a: 0.7 * b, b, relA: 0.05, relB: 0.02, frames: 8, faint: false });
  const motion = (b: number) => ({ b, relB: 0.02, pairs: 9 });

  it("takes motion's size when the edges agree, or say smaller (motion is only ever read short)", () => {
    expect(plateSize(motion(27), edges(27.5), seed).ext!.b).toBe(27);
    expect(plateSize(motion(27), edges(22), seed).ext!.b).toBe(27);
    expect(plateSize(motion(27), edges(27), seed).ext!.relB).toBe(0.02);
  });

  it("is honest when they disagree: between the two, with half the gap as its margin", () => {
    // Dwayne's front-on squat: one stack's edges ran on to 77 px against motion's 55 (the plate was 54)
    const r = plateSize(motion(27.5), edges(38.75), seed);
    expect(r.blend).toBe(true);
    expect(r.ext!.b).toBeCloseTo(Math.sqrt(27.5 * 38.75), 6);
    // the truth can be at either end: over the 12 % scale gate, so this candidate isn't logged
    expect(r.ext!.relB).toBeCloseTo(Math.log(38.75 / 27.5) / 2, 6);
    expect(r.ext!.relB).toBeGreaterThan(0.12);
    // a small gap still reads, its margin covering both ends
    const small = plateSize(motion(30), edges(34), seed);
    expect(small.ext!.relB).toBeLessThan(0.12);
    expect(Math.exp(small.ext!.relB) * small.ext!.b).toBeGreaterThanOrEqual(34 - 1e-9);
    expect(small.ext!.b / Math.exp(small.ext!.relB)).toBeLessThanOrEqual(30 + 1e-9);
    expect(BLEND_FROM).toBe(1.1);
  });

  it("falls back to the edges with no motion read, and the seed's shape with no edge read", () => {
    expect(plateSize(null, edges(30), seed).ext!.b).toBe(30);
    const m = plateSize(motion(36), null, seed).ext!;
    expect(m.b).toBe(36);
    expect(m.a).toBeCloseTo(15 * (36 / 18), 6);
  });
});

describe("candidates that each read the set", () => {
  const one = (v: number) => ({ accepted: true, range: { lo: v, hi: v } });
  // a blended stack: its speed anywhere between what its edges (low) and its motion (high) say
  const between = (lo: number, hi: number) => ({ accepted: true, range: { lo, hi } });

  it("agree when one stack was read right and the other's size lies between its two measurements", () => {
    // the true plate 27 px: the left stack read 27 by motion; the right read 23 by motion, 27 by edges
    const k = 15;
    expect(candidatesDisagree([one(k / 27), between(k / 27, k / 23)])).toBe(false);
  });

  it("refuse when one stack's scale is off past anything its own measurements allow", () => {
    expect(candidatesDisagree([one(0.5), one(0.6)])).toBe(true);
    expect(candidatesDisagree([one(0.5), between(0.58, 0.64)])).toBe(true);
    // within 12 %: one bar read twice
    expect(candidatesDisagree([one(0.5), one(0.54)])).toBe(false);
  });

  it("only counts candidates that read the set", () => {
    expect(candidatesDisagree([one(0.5), { accepted: false, range: { lo: 0.9, hi: 0.9 } }])).toBe(false);
    expect(candidatesDisagree([one(0.5)])).toBe(false);
  });
});
