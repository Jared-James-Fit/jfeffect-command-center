/**
 * The body's read (pose/skeleton.ts, pose/technique.ts, pickAthlete in
 * pose-run.ts) on bodies built joint by joint with known angles: a side-on
 * squat, a deadlift whose hips shoot up, a front view and an angled one, and
 * a second person in the picture.
 */
import { describe, expect, it } from "vitest";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { pickAthlete } from "@/lib/lift-analysis/pose/pose-run";
import {
  anglesOf,
  frameAt,
  J,
  LANDMARKS,
  MAX_GAP_S,
  nearSide,
  smoothTrack,
  viewOf,
  type PoseFrame,
  type PoseTrack,
} from "@/lib/lift-analysis/pose/skeleton";
import { readTechnique } from "@/lib/lift-analysis/pose/technique";

const W = 1080;
const H = 1920;
const FPS = 15;
const rad = (d: number) => (d * Math.PI) / 180;

type Pose = {
  /** Lean of the shin, the torso from vertical; the thigh against horizontal (+ = hip below knee). */
  shin: number;
  thigh: number;
  torso: number;
  /** Where the ankle is (px). */
  ax?: number;
  ay?: number;
  /** Arms: hanging (deadlift) or at the shoulders (squat). */
  arms?: "hang" | "rack";
};

const LEN = { shin: 420, thigh: 440, torso: 520, upper: 300, fore: 270 };

/** A side-on body facing right, its left side nearest the camera. */
function sideBody(p: Pose, nearVis = 0.95, farVis = 0.4, farOffset = 14): PoseFrame {
  const f = new Float32Array(3 * LANDMARKS);
  const ax = p.ax ?? 500;
  const ay = p.ay ?? 1650;
  const knee = [ax + LEN.shin * Math.sin(rad(p.shin)), ay - LEN.shin * Math.cos(rad(p.shin))];
  const hip = [
    knee[0] - LEN.thigh * Math.cos(rad(p.thigh)),
    knee[1] + LEN.thigh * Math.sin(rad(p.thigh)),
  ];
  const sh = [
    hip[0] + LEN.torso * Math.sin(rad(p.torso)),
    hip[1] - LEN.torso * Math.cos(rad(p.torso)),
  ];
  const elbow = p.arms === "hang" ? [sh[0], sh[1] + LEN.upper] : [sh[0] - 120, sh[1] + 200];
  const wrist =
    p.arms === "hang" ? [sh[0], sh[1] + LEN.upper + LEN.fore] : [sh[0] - 40, sh[1] - 10];
  const heel = [ax - 60, ay + 20];
  const toe = [ax + 160, ay + 30];
  const put = (j: number, x: number, y: number, v: number) => {
    f[3 * j] = x / W;
    f[3 * j + 1] = y / H;
    f[3 * j + 2] = v;
  };
  const both = (l: number, r: number, pt: number[]) => {
    put(l, pt[0], pt[1], nearVis);
    put(r, pt[0] + farOffset, pt[1] - 4, farVis);
  };
  both(J.lShoulder, J.rShoulder, sh);
  both(J.lElbow, J.rElbow, elbow);
  both(J.lWrist, J.rWrist, wrist);
  both(J.lHip, J.rHip, hip);
  both(J.lKnee, J.rKnee, knee);
  both(J.lAnkle, J.rAnkle, [ax, ay]);
  both(J.lHeel, J.rHeel, heel);
  both(J.lToe, J.rToe, toe);
  put(J.nose, sh[0] + 60, sh[1] - 160, 0.99);
  return f;
}

/** Facing the camera: left and right a shoulder (hip) width apart. */
function frontBody(hipShiftPx = 0): PoseFrame {
  const f = new Float32Array(3 * LANDMARKS);
  const put = (j: number, x: number, y: number) => {
    f[3 * j] = x / W;
    f[3 * j + 1] = y / H;
    f[3 * j + 2] = 0.95;
  };
  const cx = 540;
  put(J.lShoulder, cx + 210, 700);
  put(J.rShoulder, cx - 210, 700);
  put(J.lHip, cx + 150 + hipShiftPx, 1150);
  put(J.rHip, cx - 150 + hipShiftPx, 1150);
  put(J.lKnee, cx + 170, 1400);
  put(J.rKnee, cx - 170, 1400);
  put(J.lAnkle, cx + 170, 1650);
  put(J.rAnkle, cx - 170, 1650);
  put(J.lElbow, cx + 300, 850);
  put(J.rElbow, cx - 300, 850);
  put(J.lWrist, cx + 300, 700);
  put(J.rWrist, cx - 300, 700);
  return f;
}

function trackOf(frames: (PoseFrame | null)[]): PoseTrack {
  return { frame: { w: W, h: H }, t: frames.map((_, i) => i / FPS), frames };
}

/** A smooth 0→1→0 over [a, b] (cosine). */
const bump = (t: number, a: number, b: number) =>
  t <= a || t >= b ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - a)) / (b - a));

/** A minimal bar read with the reps' times, the bar's path at the shoulder (squat) or the hands. */
function analysisOf(
  reps: { dir: "lower_first" | "lift_first"; con: [number, number]; ecc?: [number, number] }[],
  track: PoseTrack,
  barJoint: number,
  xDev: number[] = [],
): LiftAnalysis {
  const t = track.t;
  const x = track.frames.map((f) => (f ? f[3 * barJoint] : 0));
  const y = track.frames.map((f) => (f ? f[3 * barJoint + 1] : 0));
  return {
    units: "mm",
    fps: FPS,
    frame: { w: W, h: H },
    calibration: { ok: true, mmPerPxY: 1, relErr: 0.01 },
    series: { t, x, y, v: t.map(() => 0), ok: t.map(() => true) },
    reps: reps.map((r, i) => ({
      n: i + 1,
      dir: r.dir,
      complete: true,
      con: { start: r.con[0], end: r.con[1] },
      ecc: r.ecc ? { start: r.ecc[0], end: r.ecc[1] } : null,
      xDev: { v: xDev[i] ?? 10, u: 2, tier: "measured" },
    })),
  } as unknown as LiftAnalysis;
}

describe("the skeleton", () => {
  it("reads a side view as side and the nearer side as the one seen better", () => {
    const tr = trackOf(
      Array.from({ length: 10 }, () => sideBody({ shin: 10, thigh: -70, torso: 15 })),
    );
    expect(viewOf(tr)).toBe("side");
    expect(nearSide(tr)).toBe("left");
  });

  it("reads a front view as front, with neither side nearer", () => {
    const tr = trackOf(Array.from({ length: 10 }, () => frontBody()));
    expect(viewOf(tr)).toBe("front");
    expect(nearSide(tr)).toBeNull();
  });

  it("reads a camera turned half way round as oblique", () => {
    const tr = trackOf(
      Array.from({ length: 10 }, () =>
        sideBody({ shin: 10, thigh: -70, torso: 15 }, 0.95, 0.9, 210),
      ),
    );
    expect(viewOf(tr)).toBe("oblique");
  });

  it("gets the angles a body was built with", () => {
    const a = anglesOf(sideBody({ shin: 30, thigh: 5, torso: 40 }), "left", { w: W, h: H });
    expect(a.shin).toBeCloseTo(30, 0);
    expect(a.thigh).toBeCloseTo(5, 0);
    expect(a.torso).toBeCloseTo(40, 0);
    // knee flexion: the shin's 30° forward plus the thigh's 85° back from vertical
    expect(a.knee).toBeCloseTo(30 + 95, 0);
  });

  it("gives no angle from a joint it didn't see well", () => {
    const f = sideBody({ shin: 30, thigh: 5, torso: 40 });
    f[3 * J.lKnee + 2] = 0.3;
    const a = anglesOf(f, "left", { w: W, h: H });
    expect(a.knee).toBeNull();
    expect(a.shin).toBeNull();
    expect(a.thigh).toBeNull();
    expect(a.torso).not.toBeNull();
  });

  it("never bridges a gap in the body's track", () => {
    const frames: (PoseFrame | null)[] = Array.from({ length: 20 }, (_, i) =>
      i >= 6 && i < 6 + Math.ceil(MAX_GAP_S * FPS) + 2
        ? null
        : sideBody({ shin: 10, thigh: -70, torso: 15 }),
    );
    const sm = smoothTrack(trackOf(frames));
    expect(sm.frames[8]).toBeNull();
    expect(frameAt(sm, 9 / FPS)).toBeNull();
    expect(frameAt(sm, 2 / FPS)).not.toBeNull();
  });
});

describe("a squat filmed side-on", () => {
  // two reps; on the second the torso leans a further 12° early in the drive (hips rising first)
  const n = Math.round(6 * FPS);
  const frames = Array.from({ length: n }, (_, i) => {
    const t = i / FPS;
    const d1 = bump(t, 0.6, 2.6);
    const d2 = bump(t, 3.2, 5.2);
    const d = Math.max(d1, d2);
    // the drive's first third on rep 2 (bottom 4.2 → 5.2): extra lean peaking a fifth of the way up
    const extra = t > 4.2 && t < 4.8 ? 12 * Math.sin((Math.PI * (t - 4.2)) / 0.6) : 0;
    return sideBody({
      shin: 5 + 25 * d,
      thigh: -80 + 85 * d,
      torso: 10 + 30 * d + extra,
      arms: "rack",
    });
  });
  const track = trackOf(frames);
  const a = analysisOf(
    [
      { dir: "lower_first", ecc: [0.6, 1.6], con: [1.6, 2.6] },
      { dir: "lower_first", ecc: [3.2, 4.2], con: [4.2, 5.2] },
    ],
    track,
    J.lShoulder,
  );
  const read = readTechnique(track, a, "squat");

  it("reads it side-on with angles", () => {
    expect(read.view).toBe("side");
    expect(read.angles).toBe(true);
    expect(read.facing).toBe(1);
    expect(read.rows.map((r) => r.key)).toContain("depth");
  });

  it("measures depth, torso and shin at the bottom", () => {
    const r1 = read.reps[0].m;
    expect(r1.depth).toBeCloseTo(5, 0);
    expect(r1.torsoBottom).toBeCloseTo(40, 0);
    expect(r1.shinBottom).toBeCloseTo(30, 0);
    expect(r1.torsoDrive!).toBeLessThan(1);
  });

  it("notices the torso tipping forward early in rep 2's drive, and only there", () => {
    // the extra lean minus what the drive itself takes back by then
    expect(read.reps[1].m.torsoDrive!).toBeGreaterThan(6);
    const obs = read.observations.find((o) => o.id === "torso-drive");
    expect(obs?.rep).toBe(2);
    expect(obs?.t).toBeCloseTo(4.2, 5);
    expect(obs?.text).not.toMatch(/wrong|danger|injur|bad/i);
  });
});

describe("a deadlift whose hips rise first", () => {
  const n = Math.round(4 * FPS);
  // bar off the floor at 1.0 s, locked out at 2.0 s
  const frames = Array.from({ length: n }, (_, i) => {
    const t = i / FPS;
    const p = Math.min(1, Math.max(0, (t - 1) / 1));
    const early = Math.min(1, p / 0.35);
    const late = Math.max(0, (p - 0.35) / 0.65);
    // the knees straighten first while the back tips further over (the bar barely moves), then the hips come through
    return sideBody({
      shin: 12 * (1 - early) * (1 - late),
      thigh: -30 - 25 * early - 25 * late,
      torso: 55 + 12 * early - 57 * late,
      arms: "hang",
    });
  });
  const track = trackOf(frames);
  const a = analysisOf([{ dir: "lift_first", con: [1, 2] }], track, J.lWrist);
  const read = readTechnique(track, a, "deadlift");

  it("measures the start position", () => {
    expect(read.angles).toBe(true);
    expect(read.reps[0].m.torsoStart).toBeCloseTo(55, 0);
    expect(read.reps[0].m.hipStart).not.toBeNull();
  });

  it("sees the hips come up faster than the bar", () => {
    expect(read.reps[0].m.hipRise!).toBeGreaterThan(160);
    expect(read.observations.find((o) => o.id === "hips-first")?.rep).toBe(1);
  });

  it("finds when the knees finished straightening", () => {
    expect(read.reps[0].m.kneesStraight).not.toBeNull();
    expect(read.reps[0].m.kneesStraight!).toBeGreaterThan(0);
    expect(read.reps[0].m.kneesStraight!).toBeLessThanOrEqual(100);
  });
  it("reads the same when the bar was read at working size and the body at the clip's own", () => {
    // the bar read's frame is a quarter the size (its scale per pixel four times as many mm), as on a
    // phone or the server: every number must come out as it does with one frame for both
    const small = {
      ...a,
      frame: { w: W / 4, h: H / 4 },
      calibration: { ...a.calibration, mmPerPxY: 4 },
    } as LiftAnalysis;
    const scaled = readTechnique(track, small, "deadlift");
    for (const [k, v] of Object.entries(read.reps[0].m)) {
      if (v == null) expect(scaled.reps[0].m[k]).toBeNull();
      else expect(scaled.reps[0].m[k]).toBeCloseTo(v, 6);
    }
    expect(scaled.observations.map((o) => o.id)).toEqual(read.observations.map((o) => o.id));
  });
});

describe("what a camera that isn't side-on can't show", () => {
  it("a front view gives side-to-side movement, never joint angles", () => {
    const frames = Array.from({ length: 45 }, (_, i) => frontBody(i > 15 && i < 30 ? 40 : 0));
    const track = trackOf(frames);
    const a = analysisOf(
      [{ dir: "lower_first", ecc: [0.5, 1.4], con: [1.4, 2.4] }],
      track,
      J.lShoulder,
    );
    const read = readTechnique(track, a, "squat");
    expect(read.view).toBe("front");
    expect(read.angles).toBe(false);
    expect(read.rows.map((r) => r.key)).toEqual(["hipShift"]);
    expect(read.reps[0].m.depth).toBeUndefined();
    expect(read.reps[0].m.hipShift).toBeCloseTo((40 / 300) * 100, 0);
    expect(read.limits.join(" ")).toMatch(/side view/);
  });

  it("an angled camera shows no numbers and says why", () => {
    const frames = Array.from({ length: 30 }, () =>
      sideBody({ shin: 10, thigh: -70, torso: 15 }, 0.95, 0.9, 210),
    );
    const track = trackOf(frames);
    const a = analysisOf(
      [{ dir: "lower_first", ecc: [0.2, 0.9], con: [0.9, 1.8] }],
      track,
      J.lShoulder,
    );
    const read = readTechnique(track, a, "squat");
    expect(read.view).toBe("oblique");
    expect(read.rows).toEqual([]);
    expect(read.observations.filter((o) => o.id !== "drift-grew")).toEqual([]);
    expect(read.limits.join(" ")).toMatch(/angle/);
  });
});

describe("the athlete, not whoever else is in the picture", () => {
  const body = (cx: number, cy: number, half: number) => ({
    cx,
    cy,
    size: (2 * half) ** 2,
    box: [cx - half, cy - half, cx + half, cy + half] as [number, number, number, number],
  });

  it("is the one holding the bar, even when someone bigger is nearer the camera", () => {
    expect(
      pickAthlete([body(0.7, 0.5, 0.3), body(0.3, 0.5, 0.15)], { fx: 0.3, fy: 0.45 }, null),
    ).toBe(1);
  });

  it("is the one where the athlete just was, with no bar to go by", () => {
    expect(
      pickAthlete([body(0.7, 0.5, 0.3), body(0.32, 0.5, 0.15)], null, { cx: 0.3, cy: 0.5 }),
    ).toBe(1);
  });

  it("is nobody when the only body found is someone else", () => {
    expect(pickAthlete([body(0.75, 0.5, 0.2)], null, { cx: 0.3, cy: 0.5 })).toBe(-1);
    expect(pickAthlete([body(0.75, 0.5, 0.1)], { fx: 0.3, fy: 0.45 }, { cx: 0.3, cy: 0.5 })).toBe(
      -1,
    );
  });

  it("is the biggest body at the start, with nothing else to go by", () => {
    expect(pickAthlete([body(0.3, 0.5, 0.1), body(0.7, 0.5, 0.25)], null, null)).toBe(1);
  });
});
