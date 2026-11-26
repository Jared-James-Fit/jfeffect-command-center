/**
 * The rules production's refusals pointed at (Nov 22 2026): every athlete's
 * clip was filmed 25–35° round from side-on, and reads within a few hundredths
 * of the truth were thrown away for it; a plate hidden for a moment inside a
 * press cost a rep its mean; a slow lockout made a finished rep "incomplete";
 * and a less-sure detection must prove itself before it's read on its own.
 */
import { describe, expect, it } from "vitest";
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { autoReadCheck } from "@/lib/lift-analysis/auto-check";
import { velocityVerdict } from "@/lib/lift-analysis/verdict";
import type { TrackPoint } from "@/lib/lift-analysis/track";

/** Squat-like reps at 30 fps; `hide` blanks the plate between those times. */
function track(opts: { hide?: [number, number][]; reps?: number } = {}): TrackPoint[] {
  const fps = 30;
  const reps = opts.reps ?? 2;
  const pts: TrackPoint[] = [];
  for (let i = 0; i < (2 + 2 * reps + 2) * fps; i++) {
    const t = i / fps;
    const ph = Math.max(0, Math.min(1, (t - 1) / (2 * reps))) * Math.PI * 2 * reps;
    const y = 160 + (98 * (1 - Math.cos(ph))) / 2;
    const hidden = (opts.hide ?? []).some(([a, b]) => t >= a && t <= b);
    pts.push({ t, x: 140, y, r: 40, a: 40, b: 40, conf: 1, found: !hidden });
  }
  return pts;
}

const read = (pts: TrackPoint[]): LiftAnalysis =>
  analyzeTrack(pts, {
    plate: {mm:450,rel:0.01,confirmed:true},
    source: "auto",
    seed: { x: 140, y: 160, r: 40, t: 0 },
    frame: { w: 270, h: 480 },
    dirHint: "lower_first",
  });

const withView = (a: LiftAnalysis, view: "turned" | "tilted", ratio: number): LiftAnalysis => ({
  ...a,
  plate: { ...a.plate, view, ratio, offDeg: (Math.acos(ratio) * 180) / Math.PI },
});

describe("the camera's angle", () => {
  it("a phone turned up to ~40° still logs: the plate's tall axis is its true size", () => {
    const a = read(track());
    expect(velocityVerdict(withView(a, "turned", 0.82)).accepted).toBe(true);
    expect(velocityVerdict(withView(a, "turned", 0.78)).accepted).toBe(true);
    // past ~40° it's still logged, as an estimate (Nov 25 2026: slightly off is fine), up to ~53°
    const far = velocityVerdict(withView(a, "turned", 0.7));
    expect(far.accepted).toBe(true);
    expect(far.tier).toBe("estimated");
    expect(velocityVerdict(withView(a, "turned", 0.55)).reasons).toContain("camera_angle");
  });
  it("a phone tilted up or down: measured within ~25°, an estimate to ~41°", () => {
    const a = read(track());
    expect(velocityVerdict(withView(a, "tilted", 0.92)).accepted).toBe(true);
    expect(velocityVerdict(withView(a, "tilted", 0.92)).tier).toBe("measured");
    expect(velocityVerdict(withView(a, "tilted", 0.85)).tier).toBe("estimated");
    expect(velocityVerdict(withView(a, "tilted", 0.7)).reasons).toContain("camera_angle");
  });
});

describe("a plate hidden for a moment", () => {
  it("inside a press, both ends seen: the rep's mean is still measured and the set logs", () => {
    // rep 1's press runs ~2–3 s: a hand over the plate for a third of a second in the middle of it
    const a = read(track({ hide: [[2.35, 2.65]] }));
    expect(a.reps.length).toBe(2);
    expect(a.reps[0].mcv.tier).toBe("measured");
    // the peak and the sticking point weren't seen: never shown as measured
    expect(a.reps[0].peak.tier).toBe("unavailable");
    expect(a.velocity.accepted).toBe(true);
  });
  it("over a rep's end: no mean, nothing logged", () => {
    const a = read(track({ hide: [[2.8, 3.4]] }));
    expect(a.velocity.accepted).toBe(false);
  });
  it("lost inside the set a moment longer than a rep: an estimate; much longer: never logged", () => {
    const a = read(track({ reps: 3 }));
    const brief = {
      ...a,
      track: { keys: [], lost: [{ start: 3, end: 4.3 }], conflicts: 0 },
    } as LiftAnalysis;
    expect(velocityVerdict(brief).tier).toBe("estimated");
    const lost = {
      ...a,
      track: { keys: [], lost: [{ start: 3, end: 5 }], conflicts: 0 },
    } as LiftAnalysis;
    expect(velocityVerdict(lost).reasons).toContain("plate_lost");
  });
});

describe("reading on its own", () => {
  it("a sure plate whose read is a lift is kept", () => {
    expect(autoReadCheck(read(track()), "squat", "high").ok).toBe(true);
  });
  it("a less-sure plate is kept only when the set passes every rule for logging", () => {
    const a = read(track());
    expect(autoReadCheck(a, "squat", "medium").ok).toBe(true);
    const refused = { ...a, velocity: { ...a.velocity, accepted: false } } as LiftAnalysis;
    expect(autoReadCheck(refused, "squat", "medium").ok).toBe(false);
  });
  it("a 'plate' whose reps no lift has (a head scaled as if it were 450 mm) waits for a look", () => {
    const a = read(track());
    const huge = {
      ...a,
      reps: a.reps.map((r) => ({ ...r, top: r.bottom + 1400 })),
    } as LiftAnalysis;
    expect(autoReadCheck(huge, "squat", "high").ok).toBe(false);
    const benchy = {
      ...a,
      reps: a.reps.map((r) => ({ ...r, top: r.bottom + 800 })),
    } as LiftAnalysis;
    expect(autoReadCheck(benchy, "bench", "high").ok).toBe(false);
  });
});
