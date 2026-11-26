import type { LiftAnalysis } from "./analyze";
import { MOVEMENT_ROM_MM, type Movement } from "./exercise";

/**
 * Setup suitability for the analysis screen only (never the workout card):
 * how well the clip was set up to be read, not a probability or a validated
 * error estimate. A standard plate taken as 450 mm counts half the calibration.
 */
export function setupQuality(a: LiftAnalysis) {
  const cal = a.units === "mm" && a.calibration.ok ? Math.max(0, 1 - a.calibration.relErr / 0.15) : 0;
  const parts = [
    { name: "Calibration", points: Math.round((a.plate.confirmed ? 25 : 12) * cal), max: 25 },
    { name: "Tracking", points: Math.round(25 * a.quality.tracked), max: 25 },
    { name: "Camera angle", points: Math.round(20 * Math.max(0, Math.min(1, a.plate.ratio))), max: 20 },
    { name: "Frame rate", points: a.fps >= 50 ? 15 : a.fps >= 24 ? 10 : 0, max: 15 },
    { name: "Complete reps", points: a.reps.length ? Math.round(15 * a.reps.filter(r => r.complete).length / a.reps.length) : 0, max: 15 },
  ];
  return { score: parts.reduce((s, p) => s + p.points, 0), parts };
}

/**
 * What a read must meet for its set speed to go on the logged set (Nov 25
 * 2026: tolerant of how people really film). A read inside STRICT is a
 * measurement; one inside TOLERANT is logged as an estimate (≈) with its
 * margin; outside TOLERANT nothing is logged and the reasons are said. The
 * server repeats this rule on the stored read (_apply_video_velocity in
 * 20270527101000_velocity_always_on_the_set.sql); keep the two in step.
 */
export const SPEED_RULES = {
  STRICT: { maxScaleRel: 0.03, minViewRatio: 0.9, minTurnedRatio: 0.77, minTracked: 0.75, maxLostInsideS: 1, romSpread: 0.3, maxRel: 0.08 },
  TOLERANT: { maxScaleRel: 0.12, minViewRatio: 0.75, minTurnedRatio: 0.6, minTracked: 0.7, maxLostInsideS: 1.5, romSpread: 0.35, maxRel: 0.35 },
  minFps: 24,
  /** A standard plate taken as 450 mm (bumpers and 20 kg / 25 kg / 45 lb plates are 450 ± 1–9 mm). */
  assumedPlateRel: 0.02,
} as const;

export type SetSpeed = {
  value: number;
  uncertainty: number;
  tier: "measured" | "estimated";
  metric: Movement["metric"];
  /** Every rep's range fits the movement with the plate size used (the size check for an unconfirmed plate). */
  plateCheck: boolean;
};

const repValue = (r: LiftAnalysis["reps"][number], metric: Movement["metric"]) =>
  metric === "peak" ? r.peak : r.mcv;

/**
 * The set's speed (pure): the plain mean of every rep's MCV (or, for an
 * Olympic lift, every rep's peak), only when every rep was found, complete
 * and read. A partial set is never averaged and called the set.
 */
export function calibratedSetMean(a: LiftAnalysis, movement: Movement = a.movement ?? { kind: "other", metric: "mcv" }): SetSpeed | null {
  const T = SPEED_RULES.TOLERANT;
  const S = SPEED_RULES.STRICT;
  const metric = movement.metric;
  if (a.units !== "mm" || !a.calibration.ok || a.fps < SPEED_RULES.minFps) return null;
  if (a.quality.notes.includes("camera_moved")) return null;
  if (!(a.quality.tracked >= T.minTracked)) return null;
  const lost = a.track?.lost ?? [];
  if (lost.some(g => g.end - g.start > T.maxLostInsideS)) return null;
  if (!a.reps.length) return null;
  if (a.reps.some(r => { const m = repValue(r, metric); return !r.complete || m.v == null || m.tier === "unavailable"; })) return null;
  const ratio = Number.isFinite(a.plate.ratio) ? a.plate.ratio : 1;
  // front-on (plates edge-on): the width is the stack's thickness, never an angle; the height is the ruler
  const front = a.plate.view === "front";
  if (!front && ratio < (a.plate.view === "turned" ? T.minTurnedRatio : T.minViewRatio)) return null;
  if (a.calibration.relErr > T.maxScaleRel) return null;
  const roms = a.reps.map(r => r.top - r.bottom);
  const sorted = [...roms].sort((x, y) => x - y);
  const mid = sorted[sorted.length >> 1];
  if (!mid || roms.some(r => !Number.isFinite(r) || Math.abs(r - mid) > mid * T.romSpread)) return null;
  const vals = a.reps.map(r => repValue(r, metric));
  const value = vals.reduce((s, m) => s + (m.v ?? 0), 0) / vals.length;
  if (!(value > 0 && value <= 3.5)) return null;
  // the scale's error is shared by every rep, so it never averages away
  const scaleRel = Math.hypot(a.calibration.relErr, a.plate.confirmed ? 0 : SPEED_RULES.assumedPlateRel);
  const repU = Math.sqrt(vals.reduce((s, m) => s + (m.u ?? value * 0.1) ** 2, 0)) / vals.length;
  const uncertainty = Math.hypot(repU, 2 * scaleRel * value);
  if (uncertainty / value > T.maxRel) return null;
  const [lo, hi] = MOVEMENT_ROM_MM[movement.kind];
  const plateCheck = roms.every(r => r >= lo && r <= hi);
  const strict =
    a.calibration.relErr <= S.maxScaleRel &&
    !front &&
    ratio >= (a.plate.view === "turned" ? S.minTurnedRatio : S.minViewRatio) &&
    a.quality.tracked >= S.minTracked &&
    !lost.some(g => g.end - g.start > S.maxLostInsideS) &&
    !roms.some(r => Math.abs(r - mid) > mid * S.romSpread) &&
    vals.every(m => m.tier === "measured") &&
    uncertainty / value <= S.maxRel;
  return {
    value: Math.round(value * 1000) / 1000,
    uncertainty: Math.round(uncertainty * 10000) / 10000,
    tier: strict ? "measured" : "estimated",
    metric,
    plateCheck,
  };
}
