/**
 * The any-angle estimate (estimate.ts) on a clip with a known answer: a squat
 * filmed from the front, where the plates are seen edge-on (a dark upright
 * block, never a circle), which the plate engine can't read. The plates' height
 * is the ruler (450 mm at any yaw), so the speed is an estimate and labelled one.
 */
import { describe, expect, it } from "vitest";
import { estimateRead } from "@/lib/lift-analysis/estimate";
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

describe("estimate: front-on plates (edge-on stacks)", () => {
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
