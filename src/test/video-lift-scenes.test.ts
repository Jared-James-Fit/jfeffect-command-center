import { describe, expect, it } from "vitest";
import { readLift } from "@/lib/video-edit/lift-window";
import { buildScene, gradeLift, sampleScene, type LiftGrade, type SceneOptions } from "./helpers/lift-scenes";

/**
 * The lift finder against simulated sets (helpers/lift-scenes.ts): a propped
 * phone, a lifter who walks from the lens to the bar, lifts and walks back,
 * with what a real gym adds (people crossing, standing around, lifting at the
 * next station, dark clothes, a platform that shakes). Seeded, so a number
 * here only moves when the finder does.
 */
function run(seed: number, opts: Partial<SceneOptions> = {}, step = 1) {
  const scene = buildScene({ seed, ...opts });
  const read = readLift(sampleScene(scene, step, 0.03, seed), scene.w, scene.h, scene.duration);
  return { scene, read, grade: gradeLift(read.window, scene) };
}

function tally(n: number, opts: Partial<SceneOptions>, step: number) {
  const by: Partial<Record<LiftGrade, number>> = {};
  for (let seed = 1; seed <= n; seed++) {
    const g = run(seed, opts, step).grade;
    by[g] = (by[g] ?? 0) + 1;
  }
  const share = (...gs: LiftGrade[]) => gs.reduce((s, g) => s + (by[g] ?? 0), 0) / n;
  return { by, share };
}

describe("the lift finder on simulated sets", () => {
  it("a self-filmed deadlift with people around: the walks go, every rep stays", () => {
    for (const seed of [2, 3, 4, 6]) {
      const { scene, read, grade } = run(seed, { lift: "deadlift", selfFilmed: true, crossers: 2, loiterers: 1, otherLifters: 1 });
      expect(read.why, `seed ${seed}`).toBe("found");
      expect(grade, `seed ${seed}`).toBe("ok");
      const t = scene.truth;
      // the walk from the phone is out, and so is the walk back to it
      expect(read.window!.start).toBeGreaterThan(t.arrive - 1.5);
      expect(read.window!.end).toBeLessThan(scene.duration - 1);
      expect(read.window!.start).toBeLessThan(t.firstRep);
      expect(read.window!.end).toBeGreaterThan(t.lastRep);
    }
  });

  it("a squat on a platform that shakes the phone as the bar lands keeps its last rep", () => {
    for (const seed of [1, 2, 4, 5]) {
      const { scene, read, grade } = run(seed, { lift: "squat", selfFilmed: true, shake: true });
      expect(grade, `seed ${seed}`).toBe("ok");
      expect(read.window!.end).toBeGreaterThan(scene.truth.lastRep);
    }
  });

  it("a bench filmed by a friend (nobody walks to the lens) is never cut into", () => {
    for (const seed of [2, 3, 5, 10]) {
      const { scene, read } = run(seed, { lift: "bench", selfFilmed: false });
      if (!read.window) continue;
      expect(read.window.start, `seed ${seed}`).toBeLessThan(scene.truth.firstRep);
      expect(read.window.end, `seed ${seed}`).toBeGreaterThan(scene.truth.lastRep);
    }
  });

  it("keyframes two seconds apart (a clip filmed in the app) still read", () => {
    for (const seed of [1, 2, 4, 5]) {
      const { read, grade } = run(seed, { lift: "deadlift", selfFilmed: true }, 2);
      expect(read.why, `seed ${seed}`).toBe("found");
      expect(grade, `seed ${seed}`).toBe("ok");
    }
  });

  it("frames too far apart to tell a rep from a pause get no suggestion rather than a careless one", () => {
    for (const seed of [1, 2, 4, 5]) {
      const { read } = run(seed, { lift: "deadlift", selfFilmed: true }, 3.3);
      expect(read.window, `seed ${seed}`).toBeNull();
      expect(read.why, `seed ${seed}`).toBe("sparse");
    }
  });

  it("a clip held in a hand gets no suggestion rather than a wrong one", () => {
    const { by, share } = tally(60, { handheld: true, selfFilmed: false }, 1);
    expect(by.cut ?? 0).toBe(0);
    expect(share("none", "none-ok")).toBeGreaterThanOrEqual(0.95);
  });

  it("across 300 mixed sets at a frame a second: it rarely cuts into the lifting and nearly always has a suggestion", () => {
    const { by, share } = tally(300, {}, 1);
    // measured Nov 21 2026: ok 70%, cut 2%, nothing found 1% (the finder before it: ok 20%, cut 16%, nothing 27%)
    expect(share("cut"), JSON.stringify(by)).toBeLessThanOrEqual(0.04);
    expect(share("none"), JSON.stringify(by)).toBeLessThanOrEqual(0.04);
    expect(share("ok"), JSON.stringify(by)).toBeGreaterThanOrEqual(0.62);
    // a suggestion that keeps every rep, tight or a little loose
    expect(share("ok", "loose-start", "loose-end", "loose-both", "setup-clipped"), JSON.stringify(by)).toBeGreaterThanOrEqual(0.92);
  });

  it("across 300 mixed sets at a frame every two seconds: still useful, never careless", () => {
    const { by, share } = tally(300, {}, 2);
    expect(share("cut"), JSON.stringify(by)).toBeLessThanOrEqual(0.08);
    expect(share("ok"), JSON.stringify(by)).toBeGreaterThanOrEqual(0.6);
  });
});
