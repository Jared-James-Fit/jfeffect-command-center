import { describe, expect, it } from "vitest";
import {
  packPose,
  poseBarSeries,
  poseSummary,
  poseWindowFor,
  storedPoseCovers,
  unpackPose,
  POSE_PACK_VERSION,
} from "@/lib/lift-analysis/pose/pose-pack";
import { LANDMARKS, type PoseTrack } from "@/lib/lift-analysis/pose/skeleton";
import { poseWords } from "@/routes/_authenticated/admin/settings_.velocity";

function frame(seed: number): Float32Array {
  const f = new Float32Array(3 * LANDMARKS);
  for (let j = 0; j < LANDMARKS; j++) {
    f[3 * j] = ((seed * 7 + j * 13) % 100) / 100;
    f[3 * j + 1] = ((seed * 11 + j * 5) % 100) / 100;
    f[3 * j + 2] = ((seed + j) % 10) / 10;
  }
  return f;
}

describe("pose pack", () => {
  it("round-trips a track to well under a pixel, keeping frames with no body", () => {
    const track: PoseTrack = {
      frame: { w: 1080, h: 1920 },
      t: [0, 1 / 15, 2 / 15, 3 / 15],
      frames: [frame(1), null, frame(3), frame(4)],
    };
    const packed = packPose(track);
    expect(packed.v).toBe(POSE_PACK_VERSION);
    const back = unpackPose(JSON.parse(JSON.stringify(packed)))!;
    expect(back.frame).toEqual({ w: 1080, h: 1920 });
    expect(back.t.map((x) => Math.round(x * 1000))).toEqual([0, 67, 133, 200]);
    expect(back.frames[1]).toBeNull();
    for (const i of [0, 2, 3]) {
      const a = track.frames[i]!;
      const b = back.frames[i]!;
      for (let k = 0; k < a.length; k++) {
        // 1/16000 of the frame: under 0.13 px on a 1920 px side
        expect(Math.abs(a[k] - b[k])).toBeLessThan(1 / 15000);
      }
    }
  });

  it("keeps a landmark the model put off the frame, and never reads a missing one as 'no body'", () => {
    const f = new Float32Array(3 * LANDMARKS);
    f[0] = -0.4;
    f[1] = 1.3;
    f[2] = 0.9;
    // landmark 1 missing: visibility NaN
    f[3] = 0.5;
    f[4] = 0.5;
    f[5] = Number.NaN;
    const back = unpackPose(packPose({ frame: { w: 100, h: 100 }, t: [0], frames: [f] }))!;
    expect(back.frames[0]).not.toBeNull();
    expect(back.frames[0]![0]).toBeCloseTo(-0.4, 3);
    expect(back.frames[0]![1]).toBeCloseTo(1.3, 3);
    expect(back.frames[0]![5]).toBe(0);
  });

  it("refuses what isn't a packed track", () => {
    expect(unpackPose(null)).toBeNull();
    expect(unpackPose({ v: 2, w: 1, h: 1, t: [], f: "" })).toBeNull();
    expect(unpackPose({ v: 1, w: 0, h: 1, t: [], f: "" })).toBeNull();
    // the wrong number of bytes for its frames
    expect(unpackPose({ v: 1, w: 10, h: 10, t: [0, 1], f: "AAAA" })).toBeNull();
  });
});

describe("pose window", () => {
  const a = { window: { start: 4.2, end: 19.8 } };

  it("reads the set's window with Technique's half second either side, inside the clip", () => {
    expect(poseWindowFor(a, 30)).toEqual({ start: 3.7, end: 20.3, whole: false, duration: 30 });
    expect(poseWindowFor(a, 20)).toEqual({ start: 3.7, end: 20, whole: false, duration: 20 });
    expect(poseWindowFor({ window: { start: 0.2, end: 5 } }, 10).start).toBe(0);
  });

  it("reads the clip from its start when there's no set window", () => {
    expect(poseWindowFor(null, 42)).toEqual({ start: 0, end: 42, whole: true, duration: 42 });
    expect(poseWindowFor({ window: null }, 200)).toEqual({
      start: 0,
      end: 90,
      whole: true,
      duration: 200,
    });
    expect(poseWindowFor(undefined)).toEqual({ start: 0, end: 90, whole: true, duration: null });
    // a missing start or end is no window (as the database reads it), never 0
    expect(poseWindowFor({ window: { start: null as never, end: 8 } }, 20)).toEqual({
      start: 0,
      end: 20,
      whole: true,
      duration: 20,
    });
  });

  it("uses a stored read only while it covers what Technique would read", () => {
    const stored = poseWindowFor(a, 30);
    expect(storedPoseCovers(stored, a)).toBe(true);
    // the bar read again and the set's window grew past what was read
    expect(storedPoseCovers(stored, { window: { start: 2, end: 19.8 } })).toBe(false);
    expect(storedPoseCovers(stored, { window: { start: 4.2, end: 25 } })).toBe(false);
    // a little either side is within the slack
    expect(storedPoseCovers(stored, { window: { start: 4.4, end: 20 } })).toBe(true);
    // a window that runs to the clip's end is covered by a read that stops there
    expect(storedPoseCovers(poseWindowFor(a, 20), a)).toBe(true);
    // a read of the whole clip covers any set inside it, and no set window at all
    const whole = poseWindowFor(null, 30);
    expect(storedPoseCovers(whole, a)).toBe(true);
    expect(storedPoseCovers(whole, null)).toBe(true);
    // a set-window read doesn't stand in for a whole-clip read
    expect(storedPoseCovers(stored, null)).toBe(false);
    expect(storedPoseCovers(null, a)).toBe(false);
  });
});

describe("bar hint for the body read", () => {
  const series = { t: [0, 1], x: [0.4, 0.4], y: [0.3, 0.6] };
  it("tells the lifter by the bar from a side or turned read, never a front-on stack's path", () => {
    expect(poseBarSeries({ series, plate: { view: "side" } })).toEqual(series);
    expect(poseBarSeries({ series, plate: { view: "turned" } })).toEqual(series);
    // a front-on read follows the plate stack at the end of the bar, outside the lifter's outline
    expect(poseBarSeries({ series, plate: { view: "front" } })).toBeNull();
    expect(poseBarSeries({ series: { t: [], x: [], y: [] } })).toBeNull();
    expect(poseBarSeries(null)).toBeNull();
  });
});

describe("pose summary and admin words", () => {
  it("keeps what was seen, rounded, never the metric definitions", () => {
    const s = poseSummary({
      lift: "squat",
      view: "side",
      side: "right",
      facing: 1,
      coverage: 0.91234,
      angles: true,
      rows: [{ key: "depth", label: "Depth", unit: "°", hint: "" }],
      reps: [
        {
          n: 1,
          at: { start: 1.234, turn: 2.345, end: 3.456 },
          m: { depth: 4.567, kneeBottom: null },
        },
      ],
      observations: [{ id: "x", text: "Hips rose first on rep 3.", t: 9.876, rep: 3 }],
      limits: [],
    });
    expect(s).not.toHaveProperty("rows");
    expect(s.coverage).toBe(0.912);
    expect(s.reps[0]).toEqual({
      n: 1,
      at: { start: 1.2, turn: 2.3, end: 3.5 },
      m: { depth: 4.6, kneeBottom: null },
    });
    expect(s.observations[0].t).toBe(9.9);
  });

  it("says where a body read stands in words", () => {
    const base = {
      attempts: 1,
      available_at: null,
      found: 172,
      frames: 281,
      view: "side",
      error: null,
      why: null,
      compute_ms: 24000,
      observations: 2,
    };
    expect(poseWords(null)).toBeNull();
    expect(poseWords({ ...base, status: "done" })?.text).toBe(
      "Body read: 172 of 281 frames, side view, 2 observations",
    );
    expect(poseWords({ ...base, status: "no_body" })?.text).toMatch(/no one found/);
    expect(
      poseWords({ ...base, status: "failed", error: "The body read took too long." })?.text,
    ).toMatch(/failed: The body read took too long/);
    expect(
      poseWords({
        ...base,
        status: "queued",
        available_at: new Date(Date.now() + 600_000).toISOString(),
        error: "x",
      })?.text,
    ).toMatch(/trying again/);
  });
});
