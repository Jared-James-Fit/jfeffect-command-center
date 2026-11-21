/**
 * The pieces the bar-path overhaul (bar-path/3) added, each on its own:
 * the plate's centre by radial symmetry, its outer edge (outermost, round
 * its own centre, an oval when the phone is off side-on), the plate's size
 * across still frames and its change with height (a tilted phone), following
 * both ways from keys and merging, decoy plates on a tree, the footage
 * check, and what a "needs a look" read keeps for the next open.
 */
import { describe, expect, it } from "vitest";
import type { Frame, Gray } from "@/lib/lift-analysis/image";
import { outerRim, rimSize, sizeGradient, symmetryCentre } from "@/lib/lift-analysis/rim-outer";
import { lostStretches, mergePasses, type KeyedPoint } from "@/lib/lift-analysis/keyed";
import {
  fixedSpots,
  passesThrough,
  type CircleTrack,
  type Sighting,
} from "@/lib/lift-analysis/find";
import { footageIssues } from "@/lib/lift-analysis/footage";
import { preselectOf, proposalSuggestions } from "@/lib/lift-analysis/suggestions";
import { analyzeTrack } from "@/lib/lift-analysis/analyze";
import type { TrackPoint } from "@/lib/lift-analysis/track";

/** A grey picture with ovals painted on it, 4 × 4 supersampled at the edges. */
function paint(
  w: number,
  h: number,
  bg: number,
  shapes: { cx: number; cy: number; a: number; b: number; v: number }[],
): Gray {
  const px = new Uint8Array(w * h).fill(bg);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let val = bg;
      // later shapes on top
      let acc = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const X = x + (sx + 0.5) / 4;
          const Y = y + (sy + 0.5) / 4;
          let v = bg;
          for (const s of shapes)
            if (((X - s.cx) / s.a) ** 2 + ((Y - s.cy) / s.b) ** 2 <= 1) v = s.v;
          acc += v;
        }
      val = acc / 16;
      px[y * w + x] = Math.round(val);
    }
  return { w, h, px };
}

/** An iron plate: dark face, a lighter lip just inside the edge, a bright hub. */
function plate(cx: number, cy: number, R: number, q = 1) {
  return [
    { cx, cy, a: R * q, b: R, v: 40 },
    { cx, cy, a: 0.92 * R * q, b: 0.92 * R, v: 70 },
    { cx, cy, a: 0.86 * R * q, b: 0.86 * R, v: 40 },
    { cx, cy, a: 0.22 * R * q, b: 0.22 * R, v: 150 },
    { cx, cy, a: 0.08 * R * q, b: 0.08 * R, v: 210 },
  ];
}

describe("the plate's centre and outer edge", () => {
  // the engine's pixel coordinates put a pixel's centre on the integer: a shape painted at (x, y) with
  // pixel centres at +0.5 sits at (x − 0.5, y − 0.5) there
  it("finds the centre by radial symmetry from a guess a quarter of a radius off", () => {
    const img = paint(200, 200, 110, plate(100.3, 98.6, 40));
    const c = symmetryCentre(img, 109, 92, 40)!;
    expect(c).not.toBeNull();
    expect(Math.hypot(c.x - 99.8, c.y - 98.1)).toBeLessThan(0.2);
  });

  it("finds an oval plate's centre too (its edge normals don't meet at the centre)", () => {
    const q = Math.cos((25 * Math.PI) / 180);
    const img = paint(200, 200, 110, plate(100, 100, 40, q));
    const c = symmetryCentre(img, 103, 96, 38, 0.3, [0.74, 0.82, 0.9, 1, 1.1, 1.22, 1.35])!;
    expect(Math.hypot(c.x - 99.5, c.y - 99.5)).toBeLessThan(0.3);
    expect(c.q).toBeLessThan(1);
  });

  it("sizes the plate from its outermost edge, never the lip or the hub", () => {
    const img = paint(200, 200, 110, plate(100, 100, 40));
    const r = outerRim(img, 104, 97, 34, { lo: 0.5, hi: 1.8 })!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.b / 40 - 1)).toBeLessThan(0.015);
    expect(Math.abs(r.a / 40 - 1)).toBeLessThan(0.015);
  });

  it("reads an oval plate (a phone 25° off side-on) as an oval, its height right", () => {
    const q = Math.cos((25 * Math.PI) / 180);
    const img = paint(200, 200, 110, plate(100, 100, 40, q));
    const r = outerRim(img, 100, 100, 38, { lo: 0.75, hi: 1.3 })!;
    expect(Math.abs(r.b / 40 - 1)).toBeLessThan(0.015);
    expect(Math.abs(r.a / (40 * q) - 1)).toBeLessThan(0.02);
  });

  it("never takes the lifter's head peeking out behind the plate for its rim", () => {
    // a bright round head behind the plate's upper right, its edge outside the plate's
    const img = paint(220, 220, 30, [
      { cx: 138, cy: 82, a: 26, b: 30, v: 150 },
      ...plate(110, 110, 40),
    ]);
    const r = outerRim(img, 110, 110, 40, { lo: 0.75, hi: 1.3 })!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.b / 40 - 1)).toBeLessThan(0.02);
  });
});

describe("the plate's size across frames", () => {
  const rim = (b: number, share: number, y?: number) => ({
    a: b,
    b,
    share,
    contrast: 60,
    rms: 0.3,
    y,
  });

  it("counts the frames where the rim showed most of the way round", () => {
    const s = rimSize([
      rim(40, 0.98),
      rim(40.1, 0.97),
      rim(39.9, 0.99),
      rim(38.6, 0.86),
      rim(38.8, 0.88),
    ])!;
    expect(Math.abs(s.b - 40)).toBeLessThan(0.2);
    expect(s.frames).toBe(3);
  });

  it("sees the plate grow toward one end of the rep (a tilted phone) and keeps the size at the middle", () => {
    // b = 40 + 0.02·(y − 300): 3.6 % bigger from the top of the rep to the bottom
    const rims = [200, 210, 220, 380, 390, 400].map((y) => rim(40 + 0.02 * (y - 300), 0.95, y));
    const g = sizeGradient(rims, 40)!;
    expect(g).not.toBeNull();
    expect(Math.abs(g.k - 0.02)).toBeLessThan(0.002);
    const s = rimSize(rims)!;
    expect(s.grad).toBeTruthy();
    expect(Math.abs(s.b - (40 + 0.02 * (s.grad!.y0 - 300)))).toBeLessThan(0.15);
  });

  it("a level phone: no change with height", () => {
    const rims = [200, 210, 220, 380, 390, 400].map((y, i) =>
      rim(40 + (i % 2 ? 0.1 : -0.1), 0.95, y),
    );
    expect(sizeGradient(rims, 40)).toBeNull();
  });

  it("a tilted phone's perspective is taken out of the bar's travel", () => {
    // the bar rises 112 px (in a picture where the plate is 2 × 40 px = 450 mm at y = 300), the plate's
    // size changing 2 % per 100 px: read with one ruler the rep would be ~1 % off at each end
    const pts: TrackPoint[] = [];
    const fps = 60;
    const k = 0.0002 * 40; // b grows 0.008 px per px of height
    const b = (y: number) => 40 + k * (y - 300);
    // true mm: integral of 225/b(y) dy
    const mmAt = (y: number) => (225 / k) * Math.log(b(y) / 40);
    const yAt = (mm: number) => 300 + (40 / k) * (Math.exp((mm * k) / 225) - 1);
    let t = 0;
    const push = (mm: number) => {
      const y = yAt(-mm);
      pts.push({ t, x: 100, y, r: 40, a: b(y), b: b(y), conf: 1, found: true });
      t += 1 / fps;
    };
    for (let i = 0; i < 60; i++) push(0);
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i <= 60; i++) push(-560 * (0.5 - 0.5 * Math.cos((Math.PI * i) / 60)));
      for (let i = 0; i < 20; i++) push(-560);
      for (let i = 0; i <= 60; i++) push(-560 + 560 * (0.5 - 0.5 * Math.cos((Math.PI * i) / 60)));
      for (let i = 0; i < 40; i++) push(0);
    }
    void mmAt;
    const size = {
      a: 40,
      b: 40,
      relA: 0.005,
      relB: 0.005,
      frames: 6,
      faint: false,
      grad: { y0: 300, k },
    };
    const a = analyzeTrack(pts, {
      plate: { mm: 450, rel: 0.005, confirmed: true },
      source: "tap",
      seed: { x: 100, y: 300, r: 40, t: 0 },
      frame: { w: 270, h: 480 },
      dirHint: "lower_first",
      size,
    });
    expect(a.reps.length).toBe(2);
    for (const r of a.reps) expect(Math.abs((r.rom.v ?? 0) - 560)).toBeLessThan(6);
  });
});

describe("following both ways from the keys", () => {
  const p = (t: number, x: number, found: boolean, chain: boolean): KeyedPoint => ({
    t,
    x,
    y: 100,
    r: 20,
    a: 20,
    b: 20,
    conf: found ? 1 : 0,
    found,
    score: 1,
    chain,
    key: 0,
  });

  it("averages the two directions where they agree, and leaves out where they don't", () => {
    const fwd = [
      p(0, 100, true, true),
      p(1, 100.4, true, true),
      p(2, 140, true, false),
      p(3, 0, false, false),
    ];
    const bwd = [
      p(0, 100.2, true, true),
      p(1, 100.2, true, true),
      p(2, 101, true, true),
      p(3, 102, true, true),
    ];
    const { points, conflicts } = mergePasses(fwd, bwd, 20);
    expect(points[0].x).toBeCloseTo(100.1, 5);
    // disagreeing: the unbroken chain wins
    expect(points[2].x).toBe(101);
    expect(points[3].x).toBe(102);
    expect(conflicts).toBe(0);
    // both unbroken and still apart: never chosen between
    const both = mergePasses([p(0, 100, true, true)], [p(0, 130, true, true)], 20);
    expect(both.points[0].found).toBe(false);
    expect(both.conflicts).toBe(1);
  });

  it("names the stretches where the plate wasn't followed", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ t: i / 30, found: !(i >= 10 && i < 16) }));
    expect(lostStretches(pts, 0, 1, 3)).toEqual([{ start: 10 / 30, end: 15 / 30 }]);
    expect(lostStretches(pts, 0.6, 1, 3)).toEqual([]);
  });
});

describe("plates that never moved", () => {
  const track = (ys: number[]): CircleTrack => ({
    hits: ys.map(
      (y, i) =>
        ({
          x: 50,
          y,
          r: 20,
          a: 20,
          b: 20,
          coverage: 0.9,
          rms: 0.3,
          strength: 40,
          n: 40,
          t: i / 4,
          fi: i,
        }) as Sighting,
    ),
    r: 20,
    seen: 1,
    travelY: 2,
    travelX: 0,
    coverage: 0.9,
  });

  it("two plates on a tree read as one circle jumping between them", () => {
    const tree = track([100, 140, 100, 100, 140, 140, 100, 140, 100, 140]);
    expect(fixedSpots(tree)).not.toBeNull();
    expect(passesThrough(tree)).toBe(false);
  });

  it("a bar plate passes through the heights in between", () => {
    const bar = track([100, 108, 116, 124, 132, 140, 132, 124, 116, 108, 100]);
    expect(fixedSpots(bar)).toBeNull();
    expect(passesThrough(bar)).toBe(true);
  });
});

describe("the footage check", () => {
  const frame = { width: 1080, height: 1920, w: 270, h: 480 };

  it("says nothing about good footage", () => {
    expect(
      footageIssues({
        fps: 60,
        frame,
        plate: { a: 28, b: 28 },
        path: [{ x: 135, y: 300 }],
        brightness: 110,
      }),
    ).toEqual([]);
  });

  it("flags 30 fps, a small plate, a plate leaving the picture, a dark video and a phone off side-on", () => {
    const issues = footageIssues({
      fps: 30,
      frame,
      plate: { a: 6, b: 8 },
      path: [{ x: 135, y: 4 }],
      brightness: 30,
    });
    expect(issues).toEqual(["low_fps", "plate_small", "not_side_on", "plate_cut_off", "dark"]);
  });
});

describe("a read that needs a look keeps its ring", () => {
  it("round-trips the preselected marker and keeps the other circles", () => {
    const s = proposalSuggestions({
      key: { t: 1.2, fx: 0.5, fy: 0.6, fa: 0.1, fb: 0.056 },
      candidates: [{ t: 1, fx: 0.2, fy: 0.3, fr: 0.05 }],
    });
    expect(s).toHaveLength(2);
    expect(preselectOf(s)).toEqual({ t: 1.2, fx: 0.5, fy: 0.6, fa: 0.1, fb: 0.056 });
    expect(preselectOf(s.slice(1))).toBeNull();
    expect(preselectOf(null)).toBeNull();
  });
});

// keep the type import used when nothing else references Frame
export type _F = Frame;
