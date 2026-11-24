/**
 * Validation of the lift analysis engine against clips with a known answer
 * (synthetic.ts): the bar's true trajectory is written down, rendered the way
 * a phone sees it (clutter, plates on a tree, the lifter's body, motion blur,
 * noise, flicker), and the engine's numbers are checked against the truth.
 *
 * Two things are held for every rep the engine calls measured or estimated:
 *   accuracy   mean concentric velocity within 4 % (measured) / 8 % (estimated)
 *   honesty    the true value inside the engine's own 95 % margin
 * and the engine must refuse (or downgrade) what the footage can't support:
 * no plate, a moving camera, a hidden plate, a camera off side-on.
 */
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "@/lib/lift-analysis/engine";
import {
  deadliftSet,
  interp,
  renderClip,
  squatSet,
  type Clip,
  type Phase,
  type Scene,
} from "./synthetic";

const T = 120_000;

function run(
  scene: Scene,
  opts?: Parameters<typeof runEngine>[1],
): { clip: Clip; res: EngineResult } {
  const clip = renderClip(scene);
  return { clip, res: runEngine(clip.frames, { plate: { mm:450, rel:0.01, confirmed:true }, ...opts }) };
}

function ok(res: EngineResult) {
  if (!res.ok) throw new Error(`engine refused: ${res.why}`);
  return res.analysis;
}

/** Every rep: count, accuracy, honesty of the margin. */
function checkReps(
  clip: Clip,
  res: EngineResult,
  opts: { maxErr?: number; expectTier?: "measured" | "estimated" } = {},
) {
  const a = ok(res);
  expect(a.reps.length).toBe(clip.truth.reps.length);
  a.reps.forEach((r, i) => {
    const truth = clip.truth.reps[i].mcv / 1000;
    expect(r.mcv.v).not.toBeNull();
    const v = r.mcv.v!;
    const err = Math.abs(v / truth - 1);
    const max = opts.maxErr ?? (r.mcv.tier === "measured" ? 0.04 : 0.08);
    expect(err, `rep ${i + 1}: ${v.toFixed(3)} vs ${truth.toFixed(3)}`).toBeLessThanOrEqual(max);
    // honest: the truth inside the stated 95 % margin
    expect(Math.abs(v - truth), `rep ${i + 1} margin ±${r.mcv.u?.toFixed(3)}`).toBeLessThanOrEqual(
      r.mcv.u! * 1.05,
    );
    if (opts.expectTier) expect(r.mcv.tier).toBe(opts.expectTier);
    // range of motion
    expect(Math.abs((r.rom.v ?? 0) - clip.truth.reps[i].rom)).toBeLessThanOrEqual(
      Math.max(10, (r.rom.u ?? 0) * 1.05),
    );
  });
  return a;
}

const base = (over: Partial<Scene> & { phases: Phase[] }): Scene => ({
  w: 270,
  h: 480,
  fps: 30,
  plateDiameterPx: 80,
  x0: 140,
  y0: 160,
  staticPlates: [{ x: 40, y: 330 }],
  ...over,
});

describe("lift analysis engine (synthetic clips with a known answer)", () => {
  it(
    "squat at 30 fps: finds the moving plate over the one on the tree, 3 reps, velocity loss and the sticking point",
    { timeout: T },
    () => {
      const { clip, res } = run(
        base({
          phases: squatSet({ reps: 3, rom: 560, down: 1.3, up: 1.0, dip: 0.4, slowdown: 0.3 }),
          drift: (f) => 30 * Math.sin(Math.PI * f),
        }),
      );
      const a = checkReps(clip, res, { expectTier: "measured" });
      // the plate where it really was in the frame its picture was taken from (the bar drifts)
      const xTruth = 140 - 0.5 + interp(clip.truth.x, clip.truth.t, a.plate.t) / clip.truth.mmPerPx;
      expect(Math.abs(a.plate.x - xTruth)).toBeLessThan(2);
      expect(a.plate.source).toBe("auto");
      expect(a.dir).toBe("lower_first");
      expect(a.calibration.ok).toBe(true);
      // velocity loss: fastest (rep 1) to last, against the truth
      const tr = clip.truth.reps;
      const vlTruth = (1 - tr[2].mcv / tr[0].mcv) * 100;
      expect(a.set.velocityLoss.v).not.toBeNull();
      expect(Math.abs(a.set.velocityLoss.v! - vlTruth)).toBeLessThanOrEqual(
        a.set.velocityLoss.u! * 1.05,
      );
      expect(a.set.velocityLoss.tier).toBe("measured");
      // sticking point found where it was put, on the slower reps at least
      const withStick = a.reps.filter((r) => r.sticking);
      expect(withStick.length).toBeGreaterThanOrEqual(2);
      for (const r of withStick)
        expect(Math.abs(r.sticking!.at - tr[r.n - 1].stickingFraction!)).toBeLessThan(0.08);
      // bar drifted 30 mm sideways at mid-rep and came back
      for (const r of a.reps) {
        expect(Math.abs((r.xDev.v ?? 0) - 30)).toBeLessThan(6);
        expect(Math.abs(r.xShift.v ?? 0)).toBeLessThan(6);
      }
      expect(a.quality.notes).toContain("low_fps");
      expect(a.quality.notes).not.toContain("camera_moved");
    },
  );

  it(
    "paused bench at 60 fps with a J-curve: pause measured, peak velocity measured",
    { timeout: T },
    () => {
      const { clip, res } = run(
        base({
          fps: 60,
          plateDiameterPx: 70,
          y0: 200,
          phases: squatSet({
            reps: 4,
            rom: 400,
            down: 1.1,
            up: 0.9,
            pause: 1.0,
            slowdown: 0.2,
            dip: 0.3,
          }),
          drift: (f, up) => (up ? 60 * f : 60 * f),
        }),
      );
      const a = checkReps(clip, res, { expectTier: "measured" });
      for (const r of a.reps) {
        expect(r.pause.v).not.toBeNull();
        expect(Math.abs(r.pause.v! - 1.0)).toBeLessThan(0.08);
        expect(r.peak.tier).toBe("measured");
        const truthPeak = clip.truth.reps[r.n - 1].peak / 1000;
        expect(Math.abs(r.peak.v! - truthPeak)).toBeLessThanOrEqual(r.peak.u! * 1.05);
        // the bar travels 60 mm sideways from the bottom to the top
        expect(Math.abs(Math.abs(r.xShift.v ?? 0) - 60)).toBeLessThan(8);
      }
      expect(a.quality.notes).not.toContain("low_fps");
    },
  );

  it("deadlift (lifted first) at 30 fps", { timeout: T }, () => {
    const { clip, res } = run(
      base({
        y0: 330,
        phases: deadliftSet({ reps: 2, rom: 520, up: 1.4, down: 1.2, slowdown: 0.2 }),
      }),
    );
    const a = checkReps(clip, res);
    expect(a.dir).toBe("lift_first");
    expect(a.reps.every((r) => r.ecc != null)).toBe(true);
  });

  it(
    "a fast, light set at 30 fps: short concentrics are still covered by their margin",
    { timeout: T },
    () => {
      const { clip, res } = run(
        base({ phases: squatSet({ reps: 3, rom: 500, down: 0.8, up: 0.45 }) }),
      );
      checkReps(clip, res);
    },
  );

  it("a slow grind with a deep sticking point", { timeout: T }, () => {
    const { clip, res } = run(
      base({ phases: squatSet({ reps: 1, rom: 540, down: 1.6, up: 2.8, dip: 0.75 }) }),
    );
    const a = checkReps(clip, res, { expectTier: "measured" });
    expect(a.reps[0].sticking).not.toBeNull();
    expect(Math.abs(a.reps[0].sticking!.at - clip.truth.reps[0].stickingFraction!)).toBeLessThan(
      0.08,
    );
    expect(a.reps[0].sticking!.dip).toBeGreaterThan(0.3);
  });

  it(
    "camera turned 25° off side-on: vertical speed still right, sideways path scaled by the plate's own width",
    { timeout: T },
    () => {
      const { clip, res } = run(
        base({
          yawDeg: 25,
          phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }),
          drift: (f) => 40 * Math.sin(Math.PI * f),
        }),
      );
      const a = checkReps(clip, res);
      expect(a.plate.view).toBe("turned");
      expect(Math.abs(a.plate.offDeg - 25)).toBeLessThan(5);
      expect(a.quality.notes).toContain("camera_turned");
      for (const r of a.reps) expect(Math.abs((r.xDev.v ?? 0) - 40)).toBeLessThan(8);
    },
  );

  it("camera tilted 20°: read from the plate's own height", { timeout: T }, () => {
    const { clip, res } = run(
      base({ pitchDeg: 20, phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }) }),
    );
    const a = checkReps(clip, res);
    expect(a.plate.view).toBe("tilted");
    expect(a.quality.notes).toContain("camera_tilted");
  });

  it(
    "someone walks in front of the plate during rep 2: tracking recovers, rep 2 is downgraded, the rest stay measured",
    { timeout: T },
    () => {
      const phases = squatSet({ reps: 3, rom: 550, down: 1.2, up: 1.0 });
      // rep 2's concentric starts at 0.8 + 1.2 + 0.05 + 1.0 + 0.6 + 1.2 + 0.05 = 4.9 s
      const { clip, res } = run(base({ phases, walker: { t0: 4.7, t1: 6.6 } }));
      const a = ok(res);
      expect(a.reps.length).toBe(3);
      expect(a.reps[1].coverage).toBeLessThan(0.9);
      expect(a.reps[1].mcv.tier).not.toBe("measured");
      expect(a.reps[0].mcv.tier).toBe("measured");
      expect(a.reps[2].mcv.tier).toBe("measured");
      const truth = clip.truth.reps[2].mcv / 1000;
      expect(Math.abs(a.reps[2].mcv.v! - truth) / truth).toBeLessThan(0.04);
    },
  );

  it("a handheld camera: flagged, and no speed is called measured", { timeout: T }, () => {
    const { res } = run(
      base({ shake: 3, phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }) }),
    );
    const a = ok(res);
    expect(a.quality.notes).toContain("camera_moved");
    for (const r of a.reps) expect(r.mcv.tier).not.toBe("measured");
  });

  it("a propped camera is never called moved", { timeout: T }, () => {
    const { res } = run(base({ phases: squatSet({ reps: 1, rom: 550, down: 1.2, up: 1.0 }) }));
    expect(ok(res).quality.notes).not.toContain("camera_moved");
  });

  it(
    "uneven frame timing (a phone's variable frame rate) is read from the real timestamps",
    { timeout: T },
    () => {
      const { clip, res } = run(
        base({ jitter: 0.4, phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }) }),
      );
      checkReps(clip, res);
    },
  );

  it(
    "a small plate (filmed from far away) still works, with a wider margin",
    { timeout: T },
    () => {
      const { clip, res } = run(
        base({
          plateDiameterPx: 34,
          phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }),
          staticPlates: [],
        }),
      );
      // a 34 px plate: its edge is a few pixels, so its margins run up to ±8 % and accuracy is held to 6 %
      // (the truth still has to sit inside the margin the engine states)
      const a = checkReps(clip, res, { maxErr: 0.06 });
      expect(a.calibration.relErr).toBeGreaterThan(0.012);
    },
  );

  it("120 fps: peak velocity measured, margins tight", { timeout: T }, () => {
    const { clip, res } = run(
      base({ fps: 120, phases: squatSet({ reps: 1, rom: 550, down: 1.0, up: 0.8, dip: 0.35 }) }),
    );
    const a = checkReps(clip, res, { expectTier: "measured" });
    expect(a.reps[0].peak.tier).toBe("measured");
    expect(a.reps[0].mcv.u! / a.reps[0].mcv.v!).toBeLessThan(0.05);
  });

  it("a missed last rep is counted but marked incomplete", { timeout: T }, () => {
    const phases: Phase[] = [
      ...squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }).slice(0, -1),
      { kind: "down", rom: 550, dur: 1.2 },
      { kind: "up", rom: 260, dur: 1.4 },
      { kind: "down", rom: 260, dur: 0.6 },
      { kind: "hold", dur: 0.8 },
    ];
    const { res } = run(base({ phases }));
    const a = ok(res);
    expect(a.reps.length).toBe(3);
    expect(a.reps[2].complete).toBe(false);
    expect(a.set.completeReps).toBe(2);
  });

  it("no plate in view: never confident, nothing invented", { timeout: T }, () => {
    const { res } = run(
      base({ noPlate: true, phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }) }),
    );
    expect(res.ok).toBe(false);
  });

  it(
    "a tap on the plate gives the same answer as finding it alone; a tap on nothing finds nothing",
    { timeout: T },
    () => {
      const scene = base({ phases: squatSet({ reps: 2, rom: 550, down: 1.2, up: 1.0 }) });
      const clip = renderClip(scene);
      const tapped = runEngine(clip.frames, { plate:{mm:450,rel:0.01,confirmed:true}, seed: { kind: "tap", t: 0.5, x: 150, y: 170 } });
      const auto = runEngine(clip.frames, {plate:{mm:450,rel:0.01,confirmed:true}});
      const a = ok(tapped);
      const b = ok(auto);
      expect(a.plate.source).toBe("tap");
      a.reps.forEach((r, i) => expect(Math.abs(r.mcv.v! - b.reps[i].mcv.v!)).toBeLessThan(0.01));
      const miss = runEngine(clip.frames, { seed: { kind: "tap", t: 0.5, x: 230, y: 60 } });
      expect(miss.ok).toBe(false);
    },
  );
});
