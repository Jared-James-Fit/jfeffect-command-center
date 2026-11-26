/**
 * The Nov 22 2026 fixes from the coach's 185 kg × 4 deadlift: a turned plate
 * expected as the ring's circle (its sure matches refused), stretches lost
 * with the plate in view never read again, a partial lift after the set
 * counted as a rep, velocity loss shown at ±11 % or with a rep unread, and no
 * way to say a rise isn't a rep. Synthetic clips with a known answer
 * (synthetic.ts) and pure checks.
 */
import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/lift-analysis/engine";
import { keyFromMarker, shapeAtMarker } from "@/lib/lift-analysis/detect";
import type { FollowPoint } from "@/lib/lift-analysis/follow";
import { applyRecovered, gapsToRecover, RECOVER_MAX_GAP_S } from "@/lib/lift-analysis/recover";
import { packTrack, unpackTrack } from "@/lib/lift-analysis/raw-track";
import { canEditReps, readWithout, toggleRep } from "@/lib/lift-analysis/reps-edit";
import { VL_ESTIMATE_PTS } from "@/lib/lift-analysis/analyze";
import { plateSizedRims } from "@/lib/lift-analysis/rim-outer";
import type { TrackPoint } from "@/lib/lift-analysis/track";
import { renderClip, type Phase, type Scene } from "./synthetic";

const T = 120_000;

/** Reps every ~3 s reset on the floor, and the bar picked part way up after the set with the clip ending. */
function deadliftThenMove(reps: number, after = true): Phase[] {
  const out: Phase[] = [{ kind: "hold", dur: 1 }];
  for (let r = 0; r < reps; r++) {
    out.push({ kind: "up", rom: 450, dur: 0.85 * (1 + 0.06 * r), gradual: true });
    out.push({ kind: "hold", dur: 0.35 });
    out.push({ kind: "down", rom: 450, dur: 0.55 });
    out.push({ kind: "hold", dur: 1.1 });
  }
  if (after) {
    out.push({ kind: "hold", dur: 0.8 });
    out.push({ kind: "up", rom: 260, dur: 0.6 });
    out.push({ kind: "hold", dur: 0.25 });
  } else out.push({ kind: "hold", dur: 0.8 });
  return out;
}

const scene = (over: Partial<Scene>): Scene => ({
  w: 270,
  h: 480,
  fps: 30,
  plateDiameterPx: 70,
  x0: 140,
  y0: 380,
  phases: deadliftThenMove(4),
  ...over,
});

describe("the read after the set", () => {
  it(
    "a partial lift after the set, never seen coming down, isn't a rep (4 reps, not 5)",
    { timeout: T },
    () => {
      const clip = renderClip(scene({}));
      const res = runEngine(clip.frames, { plate:{mm:450,rel:0.01,confirmed:true}, dirHint: "lift_first" });
      if (!res.ok) throw new Error(res.why);
      const a = res.analysis;
      expect(a.reps.length).toBe(4);
      expect(a.reps.every((r) => r.complete)).toBe(true);
      expect(a.quality.notes).toContain("after_set");
      expect(a.ignored?.[0]?.why).toBe("after_set");
    },
  );

  it(
    "'Not a rep' re-reads the set from its own track, and putting it back restores it",
    { timeout: T },
    () => {
      const clip = renderClip(scene({ phases: deadliftThenMove(4, false) }));
      const res = runEngine(clip.frames, { plate:{mm:450,rel:0.01,confirmed:true}, dirHint: "lift_first" });
      if (!res.ok) throw new Error(res.why);
      const a = res.analysis;
      expect(canEditReps(a)).toBe(true);
      // the same read again, untouched: the same reps and speeds
      const same = readWithout(a, [])!;
      expect(same.reps.length).toBe(a.reps.length);
      same.reps.forEach((r, i) => expect(r.mcv.v).toBeCloseTo(a.reps[i].mcv.v!, 4));
      // the first rise taken out (as if it were a setup pull)
      const out = toggleRep(a, a.reps[0].con.start, true)!;
      expect(out.reps.length).toBe(a.reps.length - 1);
      expect(out.exclude).toHaveLength(1);
      expect(out.quality.notes).toContain("reps_edited");
      expect(out.reps[0].mcv.v).toBeCloseTo(a.reps[1].mcv.v!, 4);
      expect(out.reps.map((r) => r.n)).toEqual([1, 2, 3]);
      // put back
      const back = toggleRep(out, a.reps[0].con.start, false)!;
      expect(back.reps.length).toBe(a.reps.length);
      expect(back.exclude ?? []).toHaveLength(0);
    },
  );
});

describe("velocity loss is only said when it can be trusted", () => {
  it("is never shown wider than the estimate bar", { timeout: T }, () => {
    const clip = renderClip(scene({ phases: deadliftThenMove(4, false) }));
    const res = runEngine(clip.frames, { plate:{mm:450,rel:0.01,confirmed:true}, dirHint: "lift_first" });
    if (!res.ok) throw new Error(res.why);
    const vl = res.analysis.set.velocityLoss;
    if (vl.tier !== "unavailable") expect(vl.u!).toBeLessThanOrEqual(VL_ESTIMATE_PTS);
  });

  it("isn't worked out when a rep's speed wasn't read", { timeout: T }, () => {
    // the plate covered across rep 3's whole press: that rep's speed can't be read
    const clip = renderClip(
      scene({ phases: deadliftThenMove(4, false), walker: { t0: 6.9, t1: 8.4 } }),
    );
    const res = runEngine(clip.frames, { plate:{mm:450,rel:0.01,confirmed:true}, dirHint: "lift_first" });
    if (!res.ok) throw new Error(res.why);
    const a = res.analysis;
    const unread = a.reps.some((r) => r.complete && r.mcv.tier === "unavailable");
    if (unread) {
      expect(a.set.velocityLoss.tier).toBe("unavailable");
      expect(a.set.velocityLoss.why).toBe("partial_set");
    }
  });
});

describe("a turned plate (an ellipse) from the athlete's round ring", () => {
  it("learns the plate's shape at the ring", () => {
    const clip = renderClip(scene({ yawDeg: 38, phases: deadliftThenMove(1, false) }));
    const f = clip.frames[15];
    const R = 35;
    const shape = shapeAtMarker(f, { x: 140 - 0.5, y: 380 - 0.5, a: R, b: R });
    expect(shape).not.toBeNull();
    // narrower across than tall, about cos 38° (0.79)
    expect(shape!.a / shape!.b).toBeGreaterThan(0.7);
    expect(shape!.a / shape!.b).toBeLessThan(0.9);
    const key = keyFromMarker(f, { x: 140 - 0.5, y: 380 - 0.5, a: R, b: R }, "confirmed").key;
    expect(key.a / key.b).toBeLessThan(0.92);
  });

  it("is followed through the set from a round ring", { timeout: T }, () => {
    const clip = renderClip(scene({ yawDeg: 38, phases: deadliftThenMove(4, false) }));
    const f = clip.frames[15];
    const R = 35;
    const res = runEngine(clip.frames, {
      dirHint: "lift_first",
      seed: { kind: "marker", t: f.t, x: 140 - 0.5, y: 380 - 0.5, a: R, b: R },
    });
    if (!res.ok) throw new Error(res.why);
    expect(res.analysis.quality.tracked).toBeGreaterThan(0.95);
    expect(res.analysis.reps.length).toBe(4);
  });
});

describe("reading lost stretches again", () => {
  const pt = (t: number, found: boolean): FollowPoint => ({
    t,
    x: found ? 10 : NaN,
    y: found ? 10 : NaN,
    r: 20,
    a: 20,
    b: 20,
    conf: found ? 0.8 : 0,
    found,
    score: found ? 0.9 : 0.3,
  });

  it("goes back only for stretches with the plate seen on both sides", () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => pt(i / 10, ![2, 3, 4, 8, 9].includes(i)));
    const gaps = gapsToRecover(pts);
    // 2–4 has the plate either side; 8–9 runs to the end of the clip
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ i0: 2, i1: 4 });
  });

  it("never goes back across a stretch too long to be the same set", () => {
    const n = Math.ceil((RECOVER_MAX_GAP_S + 1) * 10) + 2;
    const pts = Array.from({ length: n }, (_, i) => pt(i / 10, i === 0 || i === n - 1));
    expect(gapsToRecover(pts)).toHaveLength(0);
  });

  it("fills only frames that were lost, never moves one that was followed", () => {
    const pts = [pt(0, true), pt(0.1, false), pt(0.2, true)];
    const got = [
      { ...pt(0.1, true), x: 11 },
      { ...pt(0.2, true), x: 99 },
    ];
    const { points, recovered } = applyRecovered(pts, got);
    expect(recovered).toBe(1);
    expect(points[1].x).toBe(11);
    expect(points[2].x).toBe(10);
  });
});

describe("the track kept on a read", () => {
  it("packs and unpacks every frame to well under the tracking's own noise", () => {
    const pts: TrackPoint[] = Array.from({ length: 50 }, (_, i) => ({
      t: 1 / 30 + i / 29.97,
      x: 135.12345 + i * 0.01,
      y: 409.98765 - i,
      r: 21.5,
      a: 18.123,
      b: 22.456,
      conf: i % 7 === 0 ? 0 : 0.734,
      found: i % 7 !== 0,
    }));
    const back = unpackTrack(packTrack(pts));
    expect(back).toHaveLength(50);
    back.forEach((p, i) => {
      expect(p.t).toBe(pts[i].t);
      expect(p.found).toBe(pts[i].found);
      if (p.found) {
        expect(Math.abs(p.x - pts[i].x)).toBeLessThan(0.001);
        expect(Math.abs(p.y - pts[i].y)).toBeLessThan(0.001);
        expect(Math.abs(p.conf - pts[i].conf)).toBeLessThan(0.0001);
      } else expect(Number.isNaN(p.x)).toBe(true);
      expect(Math.abs(p.a - 18.123)).toBeLessThan(0.001);
    });
  });
});

describe("the plate's size from its own rim, not the ring the track started from", () => {
  const rim = (r: number, share = 0.9) => ({ r, share });

  it("keeps the rims near the track's size when they agree with it", () => {
    const rims = [rim(52), rim(52.4), rim(51.8), rim(60)];
    expect(plateSizedRims(rims, 52).map((r) => r.r)).toEqual([52, 52.4, 51.8]);
  });

  it("follows the rims when most frames agree on another size (a ring round the stack's outline)", () => {
    // the ring was fitted to the face and the stack's edge together: 64 px; the face measures 52
    const rims = [rim(52), rim(52.3), rim(51.7), rim(52.1), rim(64.5, 0.5)];
    expect(plateSizedRims(rims, 64).map((r) => r.r)).toEqual([52, 52.3, 51.7, 52.1]);
  });

  it("never grows past the ring (something round behind it isn't the plate)", () => {
    const rims = [rim(93), rim(92.6), rim(93.4), rim(93.1)];
    expect(plateSizedRims(rims, 76)).toEqual([]);
  });

  it("changes nothing when the frames don't agree", () => {
    const rims = [rim(52), rim(58), rim(46), rim(63)];
    expect(plateSizedRims(rims, 64).map((r) => r.r)).toEqual([58, 63]);
  });
});
