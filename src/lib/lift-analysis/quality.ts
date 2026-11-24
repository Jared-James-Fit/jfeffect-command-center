import type { LiftAnalysis } from "./analyze";

/** Setup suitability, not a probability or a validated error estimate. */
export function setupQuality(a: LiftAnalysis) {
  const parts = [
    { name: "Calibration", points: a.plate.confirmed && a.calibration.ok ? Math.round(25 * Math.max(0, 1 - a.calibration.relErr / 0.15)) : 0, max: 25 },
    { name: "Tracking", points: Math.round(25 * a.quality.tracked), max: 25 },
    { name: "Camera angle", points: Math.round(20 * Math.max(0, Math.min(1, a.plate.ratio))), max: 20 },
    { name: "Frame rate", points: a.fps >= 50 ? 15 : a.fps >= 24 ? 10 : 0, max: 15 },
    { name: "Complete reps", points: a.reps.length ? Math.round(15 * a.reps.filter(r => r.complete).length / a.reps.length) : 0, max: 15 },
  ];
  return { score: parts.reduce((s, p) => s + p.points, 0), parts };
}

export function calibratedSetMean(a: LiftAnalysis): { value: number; uncertainty: number; tier: "measured" | "estimated" } | null {
  if (!a.plate.confirmed || !a.calibration.ok || a.units !== "mm" || a.fps < 24 ||
      a.quality.notes.includes("camera_moved") || a.quality.tracked < 0.75 ||
      (a.track?.lost ?? []).some(g => g.end - g.start > 1) ||
      !a.reps.length || a.reps.some(r => !r.complete || r.mcv.v == null || r.mcv.u == null || r.mcv.tier === "unavailable")) return null;
  const ratio = a.plate.view === "turned" ? 0.77 : 0.9;
  if (!Number.isFinite(a.plate.ratio) || a.plate.ratio < ratio || a.calibration.relErr > 0.1) return null;
  const roms = a.reps.map(r => r.top - r.bottom).sort((x, y) => x - y);
  const mid = roms[roms.length >> 1];
  if (!mid || roms.some(r => !Number.isFinite(r) || Math.abs(r - mid) > mid * 0.3)) return null;
  const value = a.reps.reduce((s, r) => s + (r.mcv.v ?? 0), 0) / a.reps.length;
  // Scale error is shared by every rep; it cannot average away.
  const uncertainty = Math.hypot(Math.sqrt(a.reps.reduce((s, r) => s + (r.mcv.u ?? 0) ** 2, 0)) / a.reps.length, 2 * a.calibration.relErr * value);
  if (!(value > 0 && value <= 3.5) || uncertainty / value > 0.25) return null;
  return { value: Math.round(value * 1000) / 1000, uncertainty, tier: uncertainty / value <= 0.08 && a.reps.every(r => r.mcv.tier === "measured") ? "measured" : "estimated" };
}