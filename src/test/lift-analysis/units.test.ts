/**
 * The lift analysis engine's small rules, each on its own: smoothing on real
 * timestamps, rep legs, the margin → tier rule, the plate's rings, the
 * scale guard, which exercises are analysed and which way their reps go,
 * the load–velocity line, and how numbers are said.
 */
import { describe, expect, it } from "vitest";
import { analyzeTrack, MAX_REP_ROM_MM } from "@/lib/lift-analysis/analyze";
import { calibrate } from "@/lib/lift-analysis/calibrate";
import { analysableExercise, repDirection } from "@/lib/lift-analysis/exercise";
import {
  cm,
  percent,
  seconds,
  speed,
  speedMargin,
  summaryLine,
  withinNoise,
} from "@/lib/lift-analysis/format";
import { bridgeGaps, legs, loess, metric, NONE } from "@/lib/lift-analysis/kinematics";
import { compareToProfile, fitProfile, type LvPoint } from "@/lib/lift-analysis/profile";
import type { TrackPoint } from "@/lib/lift-analysis/track";

describe("smoothing", () => {
  it("recovers position and velocity of a parabola exactly, on uneven timestamps", () => {
    const t: number[] = [];
    let now = 0;
    for (let i = 0; i < 60; i++) {
      t.push(now);
      now += i % 3 === 0 ? 0.04 : 0.028;
    }
    const y = t.map((x) => 100 + 300 * x - 200 * x * x);
    const s = loess(
      t,
      y,
      t.map(() => 1),
      0.1,
    );
    for (let i = 5; i < 55; i++) {
      expect(s.y[i]).toBeCloseTo(y[i], 6);
      expect(s.v[i]).toBeCloseTo(300 - 400 * t[i], 5);
      expect(s.a[i]).toBeCloseTo(-400, 4);
    }
  });

  it("leaves a long gap empty, and bridging fills it for counting only", () => {
    const t = Array.from({ length: 60 }, (_, i) => i / 30);
    const y = t.map((x) => x * 100);
    const w = t.map((_, i) => (i >= 20 && i < 35 ? 0 : 1));
    const s = loess(t, y, w, 0.1);
    expect(s.ok[27]).toBe(false);
    const bridged = bridgeGaps(s, 1.2);
    expect(s.ok[27]).toBe(true);
    expect(bridged[27]).toBe(true);
    expect(bridged[10]).toBe(false);
    expect(s.y[27]).toBeCloseTo(90, 0);
  });
});

describe("reps", () => {
  it("counts big moves only: a wobble at lockout never splits a rep", () => {
    const y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const ph = (i / 100) * Math.PI * 2;
      y.push(500 * Math.cos(ph) + 8 * Math.sin(i * 1.7));
    }
    const ok = y.map(() => true);
    const l = legs(y, ok, 150);
    // 4 cycles starting at the top: down, up, down, up, …
    expect(l.filter((x) => x.dir === "up").length).toBe(4);
    expect(l[0].dir).toBe("down");
  });
});

describe("a number's tier comes from its margin", () => {
  it("measured within ±8 %, an estimate to ±25 %, nothing past that", () => {
    expect(metric(0.5, 0.02).tier).toBe("measured");
    expect(metric(0.5, 0.06).tier).toBe("estimated");
    expect(metric(0.5, 0.2).tier).toBe("unavailable");
    expect(metric(0.5, 0.02, { forceEstimate: "low_fps" }).tier).toBe("estimated");
    expect(metric(0.5, 0.02).u).toBeCloseTo(0.02, 6);
  });
});

function track(opts: { r?: number; a?: number; b?: number; rom?: number } = {}): TrackPoint[] {
  const r = opts.r ?? 40;
  const pts: TrackPoint[] = [];
  for (let i = 0; i < 300; i++) {
    const t = i / 30;
    // two squat-like reps of `rom` px, the plate's centre moving up and down
    const ph = Math.max(0, Math.min(1, (t - 1) / 4)) * Math.PI * 4;
    const y = 160 + ((opts.rom ?? 98) * (1 - Math.cos(ph))) / 2;
    pts.push({ t, x: 140, y, r, a: opts.a ?? r, b: opts.b ?? r, conf: 1, found: true });
  }
  return pts;
}

describe("calibration", () => {
  it("scale from the plate's own size; each axis its own direction", () => {
    const cal = calibrate(track({ a: 36, b: 40 }));
    expect(cal.ok).toBe(true);
    expect(cal.mmPerPxY).toBeCloseTo(450 / 80, 6);
    expect(cal.mmPerPxX).toBeCloseTo(450 / 72, 6);
    expect(cal.view).toBe("turned");
    expect(cal.offDeg).toBeGreaterThan(20);
  });
  it("refuses a plate seen too far off side-on", () => {
    expect(calibrate(track({ a: 25, b: 40 })).why).toBe("not_side_on");
  });
});

describe("the scale guard", () => {
  it("drops the scale when the 'plate' gave numbers no barbell can (a rep over a metre)", () => {
    // a small round thing taken for a 450 mm plate: every distance comes out huge
    const a = analyzeTrack(track({ r: 12, rom: 98 }), {
      plate: {mm:450,rel:0.01,confirmed:true},
      source: "auto",
      seed: { x: 140, y: 160, r: 12, t: 0 },
      frame: { w: 270, h: 480 },
    });
    expect(a.quality.notes).toContain("implausible_scale");
    expect(a.units).toBe("px");
    expect(a.set.bestMcv.tier).toBe("unavailable");
    // timing still counts
    expect(a.reps.length).toBe(2);
    expect(98 * (450 / 24)).toBeGreaterThan(MAX_REP_ROM_MM);
  });
  it("keeps a real plate's scale", () => {
    const a = analyzeTrack(track(), {
      plate: {mm:450,rel:0.01,confirmed:true},
      source: "auto",
      seed: { x: 140, y: 160, r: 40, t: 0 },
      frame: { w: 270, h: 480 },
    });
    expect(a.units).toBe("mm");
    expect(a.reps.length).toBe(2);
    expect(Math.abs((a.reps[0].rom.v ?? 0) - 98 * (450 / 80))).toBeLessThan(8);
  });
});

describe("which exercises", () => {
  it("barbell lifts yes; dumbbells, cables, machines, bodyweight no; a Smith machine yes", () => {
    for (const n of [
      "Competition Squat",
      "Paused Bench Press",
      "Sumo Deadlift",
      "Larsen Press",
      "Barbell Row",
      "Hip Thrust",
      "Smith Machine Squat",
      "Romanian Deadlift",
    ])
      expect(analysableExercise(n), n).toBe(true);
    for (const n of [
      "Dumbbell Bench Press",
      "Cable Row",
      "Leg Press",
      "Pull Up",
      "Belt Squat",
      "Machine Chest Press",
      "Hack Squat",
      "Treadmill Walk",
      "",
    ])
      expect(analysableExercise(n), n).toBe(false);
  });
  it("which way a rep goes, from the name", () => {
    expect(repDirection("Competition Deadlift")).toBe("lift_first");
    expect(repDirection("Romanian Deadlift")).toBe("lower_first");
    expect(repDirection("Close Grip Bench Press")).toBe("lower_first");
    expect(repDirection("Overhead Press")).toBe("lift_first");
    expect(repDirection("High Bar Squat")).toBe("lower_first");
    expect(repDirection("Seated Press")).toBeNull();
  });
});

describe("load–velocity", () => {
  const p = (kg: number, v: number, id = String(kg)): LvPoint => ({
    kg,
    v,
    id,
    tier: "measured",
    at: "2026-11-01",
  });
  it("a line only from enough spread, falling as load rises", () => {
    expect(fitProfile([p(100, 0.8), p(140, 0.6)])).toBeNull();
    expect(fitProfile([p(100, 0.8), p(102, 0.78), p(103, 0.79)])).toBeNull();
    expect(fitProfile([p(100, 0.5), p(130, 0.6), p(160, 0.7)])).toBeNull();
    const prof = fitProfile([p(100, 0.8), p(130, 0.62), p(160, 0.45)])!;
    expect(prof.slope).toBeLessThan(0);
    expect(prof.r2).toBeGreaterThan(0.99);
  });
  it("faster or slower than usual only past the day-to-day swing, and only within its loads", () => {
    const prof = fitProfile([p(100, 0.8), p(130, 0.62), p(160, 0.45)])!;
    const exp = prof.intercept + prof.slope * 140;
    expect(compareToProfile(prof, 140, exp * 1.03)!.call).toBe("usual");
    expect(compareToProfile(prof, 140, exp * 0.88)!.call).toBe("slower");
    expect(compareToProfile(prof, 140, exp * 1.1)!.call).toBe("faster");
    expect(compareToProfile(prof, 200, 0.3)).toBeNull();
    // a wide margin of its own holds the call back
    expect(compareToProfile(prof, 140, exp * 0.9, 0.08)!.call).toBe("usual");
  });
});

describe("how numbers are said", () => {
  it("measured as is, estimates with ≈, unavailable as a dash", () => {
    expect(speed({ v: 0.4234, u: 0.02, tier: "measured" })).toBe("0.42 m/s");
    expect(speed({ v: 0.4234, u: 0.06, tier: "estimated" })).toBe("≈0.42 m/s");
    expect(speed(NONE("not_calibrated"))).toBe("—");
    expect(speedMargin({ v: 0.42, u: 0.024, tier: "measured" })).toBe("± 0.02 m/s");
    expect(seconds({ v: 0.84, u: 0.02, tier: "measured" })).toBe("0.84 s");
    expect(cm({ v: 545, u: 10, tier: "measured" })).toBe("55 cm");
    expect(cm({ v: 32, u: 4, tier: "estimated" })).toBe("≈3.2 cm");
    expect(percent({ v: 18.4, u: 3, tier: "measured" })).toBe("18%");
    expect(withinNoise({ v: 1.2, u: 2.1, tier: "estimated" })).toBe(true);
  });
  it("a set in one line", () => {
    const a = analyzeTrack(track(), {
      plate: {mm:450,rel:0.01,confirmed:true},
      source: "auto",
      seed: { x: 140, y: 160, r: 40, t: 0 },
      frame: { w: 270, h: 480 },
    });
    // a set good enough to log says its average; one that isn't, its fastest rep
    expect(a.velocity.accepted).toBe(true);
    expect(summaryLine(a)).toMatch(/^2 reps · avg 0\.\d\d m\/s/);
    const notLogged = { ...a, velocity: { ...a.velocity, accepted: false, value: null } };
    expect(summaryLine(notLogged)).toMatch(/^2 reps · best (≈)?0\.\d\d m\/s/);
  });
});
