/**
 * What reaches the logger from a set video (verdict.ts) and how the plate's
 * position is corrected by its rim (follow.ts correctRim): pure rules, no
 * video needed.
 */
import { describe, expect, it } from "vitest";
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { correctRim, type FollowPoint } from "@/lib/lift-analysis/follow";
import {
  loadMeansFullPlates,
  loggedState,
  velocityNotLoggedText,
  velocityVerdict,
} from "@/lib/lift-analysis/verdict";
import type { TrackPoint } from "@/lib/lift-analysis/track";

/** Two squat-like reps of `rom` px at 30 fps, the plate's centre moving up and down. */
function track(opts: { rom?: number; fps?: number } = {}): TrackPoint[] {
  const fps = opts.fps ?? 30;
  const pts: TrackPoint[] = [];
  for (let i = 0; i < 10 * fps; i++) {
    const t = i / fps;
    const ph = Math.max(0, Math.min(1, (t - 1) / 4)) * Math.PI * 4;
    const y = 160 + ((opts.rom ?? 98) * (1 - Math.cos(ph))) / 2;
    pts.push({ t, x: 140, y, r: 40, a: 40, b: 40, conf: 1, found: true });
  }
  return pts;
}

const read = (opts?: { rom?: number; fps?: number }): LiftAnalysis =>
  analyzeTrack(track(opts), {
    source: "auto",
    seed: { x: 140, y: 160, r: 40, t: 0 },
    frame: { w: 270, h: 480 },
    dirHint: "lower_first",
  });

describe("the set's velocity", () => {
  it("is the plain mean of every rep's mean velocity, only when every rep was measured", () => {
    const a = read();
    expect(a.velocity.accepted).toBe(true);
    const mean = a.reps.reduce((s, r) => s + r.mcv.v!, 0) / a.reps.length;
    expect(a.velocity.value).toBeCloseTo(Math.round(mean * 1000) / 1000, 6);
    expect(a.velocity.reps).toBe(2);
  });

  it("is never averaged from part of a set: one rep short of the top and nothing is logged", () => {
    const a = read();
    const partial = {
      ...a,
      reps: a.reps.map((r, i) => (i === 1 ? { ...r, complete: false } : r)),
    } as LiftAnalysis;
    const v = velocityVerdict(partial);
    expect(v.accepted).toBe(false);
    expect(v.value).toBeNull();
    expect(v.reasons).toContain("rep_incomplete");
  });

  it("not below 24 fps, never with the camera moving, never an estimate", () => {
    expect(velocityVerdict(read({ fps: 15 })).reasons).toContain("low_fps");
    const a = read();
    expect(
      velocityVerdict({
        ...a,
        quality: { ...a.quality, notes: [...a.quality.notes, "camera_moved"] },
      }).reasons,
    ).toContain("camera_moved");
    const est = {
      ...a,
      reps: a.reps.map((r) => ({ ...r, mcv: { ...r.mcv, tier: "estimated" as const } })),
    } as LiftAnalysis;
    expect(velocityVerdict(est).reasons).toContain("rep_not_measured");
  });

  it("says why in plain words", () => {
    expect(velocityNotLoggedText(["camera_moved", "low_fps", "plate_hidden"])).toBe(
      "Not logged: the camera moved and the frame rate was too low.",
    );
  });

  it("full-size plates from 60 kg on", () => {
    expect(loadMeansFullPlates(60)).toBe(true);
    expect(loadMeansFullPlates(40)).toBe(false);
    expect(loadMeansFullPlates(null)).toBe(false);
  });
});

describe("is it on the set", () => {
  const a = read();
  const sv = "sv-1";
  it("logged when the set holds this video's number", () => {
    expect(
      loggedState(
        a,
        { velocity_source: "video", velocity_set_video_id: sv, mean_concentric_velocity_mps: 0.4 },
        sv,
      ),
    ).toEqual({
      logged: true,
    });
  });
  it("a typed velocity is kept, a rep count that differs says so, a light load asks for the plate", () => {
    expect(
      loggedState(
        a,
        {
          mean_concentric_velocity_mps: 0.52,
          velocity_source: "device",
          actual_reps: 2,
          actual_load_kg: 100,
        },
        sv,
      ),
    ).toMatchObject({
      logged: false,
      why: "typed",
    });
    const reps = loggedState(a, { actual_reps: 3, actual_load_kg: 100 }, sv);
    expect(reps).toMatchObject({ logged: false, why: "reps" });
    expect(!reps.logged && reps.text).toContain("2 reps in the video, 3 logged");
    expect(loggedState(a, { actual_reps: 2, actual_load_kg: 40 }, sv)).toMatchObject({
      logged: false,
      why: "light",
    });
    expect(loggedState(a, null, sv)).toMatchObject({ logged: false, why: "no_set" });
  });
});

describe("the plate's position", () => {
  const pt = (t: number, y: number, found = true): FollowPoint => ({
    t,
    x: 100,
    y,
    r: 40,
    a: 40,
    b: 40,
    conf: 1,
    found,
    score: 0.9,
  });
  it("the picture's match moved by the rim's smoothed offset; a stray rim reading never jumps it", () => {
    const pts = [0, 0.1, 0.2, 0.3, 0.4].map((t) => pt(t, 200));
    const off = [
      { t: 0, dx: 0, dy: 3 },
      { t: 0.1, dx: 0, dy: 3 },
      { t: 0.2, dx: 0, dy: 12 }, // one bad rim fit
      null,
      { t: 0.4, dx: 0, dy: 3 },
    ];
    const out = correctRim(pts, off);
    for (const p of out) expect(p.y).toBe(203);
  });
  it("a lost frame stays lost", () => {
    const out = correctRim([pt(0, 200), pt(0.1, NaN, false)], [{ t: 0, dx: 1, dy: 1 }, null]);
    expect(out[1].found).toBe(false);
    expect(Number.isNaN(out[1].y)).toBe(true);
  });
});
