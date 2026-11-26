/**
 * Pixels to millimetres, from the plate itself (pure). A 20 kg, 25 kg or
 * 45 lb plate and every bumper plate is 450 mm across (the IPF's and IWF's
 * own size; cast-iron 45s run 444–451 mm), so the plate's rim in the picture
 * is a ruler that moves with the bar, at the bar's own distance from the
 * camera.
 *
 * Seen exactly side-on the rim is a circle. A phone turned a little (yaw)
 * shows it narrower than it is tall; one tilted up or down (pitch) shows it
 * shorter than it is wide. Either way each axis of the ellipse measures its
 * own direction: the vertical axis scales vertical movement, the horizontal
 * axis scales horizontal movement (a weak-perspective camera, good for the
 * small angles a propped phone has). Tilt also moves the bar towards and
 * away from the camera as it rises, which this can't correct, so it costs
 * more certainty than a turn does.
 *
 * Frames where the bar is barely moving are used (no motion blur on the rim).
 */
import { madSigma, median } from "@/lib/lift-analysis/image";
import type { TrackPoint } from "@/lib/lift-analysis/track";

export const STANDARD_PLATE_MM = 450;

/** "front": the plates seen edge-on (a stack front-on): only their height is a ruler, which it is at any yaw. */
export type View = "side" | "turned" | "tilted" | "front";
export type Calibration = {
  ok: boolean;
  plateMm: number;
  mmPerPxX: number;
  mmPerPxY: number;
  /** Rim semi-axes (px) at the analysed size. */
  a: number;
  b: number;
  /** Narrow axis ÷ wide axis (1 = exactly side-on). */
  ratio: number;
  view: View;
  /** About how far off side-on, in degrees (from the ratio). */
  offDeg: number;
  /** Relative standard uncertainty of the vertical scale (0.01 = 1 %). */
  relErr: number;
  /** Same for the horizontal scale. */
  relErrX: number;
  frames: number;
  why: "ok" | "too_few_frames" | "plate_too_small" | "not_side_on";
  /** The plate's edge barely showed (black on black): the scale is known less well. */
  faint?: boolean;
};

/**
 * The plate's measured size from its outer edge (rim-outer.ts `rimSize`):
 * semi-axes in analysed px and their relative 1-σ uncertainty (edge
 * position and frame-to-frame spread included).
 */
export type RimSizeInput = {
  a: number;
  b: number;
  relA: number;
  relB: number;
  frames: number;
  faint: boolean;
  /**
   * A phone tilted up or down sees the plate bigger at one end of the rep
   * than the other (perspective): its vertical semi-axis at height y is
   * b + k·(y − y0) (working px). Only when the rims measured at the two ends
   * of the travel say so; b is then the size at y0.
   */
  grad?: { y0: number; k: number };
  /**
   * The plate's height was measured edge-on (a stack front-on, estimate.ts):
   * its width is the stack's thickness, not a view angle. Its height is still
   * its true diameter (a yaw never changes it), so the vertical scale stands,
   * with a little more uncertainty for the edge of a stack of mixed plates.
   */
  edgeOn?: boolean;
};

/** The extra relative uncertainty of a plate's height measured edge-on (smaller plates, a rounded stack edge). */
export const EDGE_ON_REL = 0.03;

export type PlateSize = {
  mm: number;
  /** Relative uncertainty of the size itself (0.01 when assumed standard, 0.005 when confirmed). */
  rel: number;
};

/** The default: a standard plate, unconfirmed (iron 45s and bumpers differ by up to ~1 %). */
export const DEFAULT_PLATE: PlateSize = { mm: STANDARD_PLATE_MM, rel: 0.01 };

export function calibrate(
  points: TrackPoint[],
  plate: PlateSize = DEFAULT_PLATE,
  size?: RimSizeInput | null,
): Calibration {
  if (size) return fromSize(plate, size);
  const good = points.filter((p) => p.found && p.conf >= 0.6);
  const base = {
    plateMm: plate.mm,
    mmPerPxX: NaN,
    mmPerPxY: NaN,
    a: NaN,
    b: NaN,
    ratio: NaN,
    view: "side" as View,
    offDeg: 0,
    relErr: Infinity,
    relErrX: Infinity,
    frames: good.length,
  };
  if (good.length < 5) return { ...base, ok: false, why: "too_few_frames" };
  // speed of each good point (pixels / s), to pick the still frames
  const speed = good.map((p, i) => {
    const q = good[i > 0 ? i - 1 : Math.min(good.length - 1, 1)];
    const dt = Math.abs(p.t - q.t) || 1;
    return Math.hypot(p.x - q.x, p.y - q.y) / dt;
  });
  const sortedSpeed = [...speed].sort((x, y) => x - y);
  const slowCut = sortedSpeed[Math.floor(sortedSpeed.length * 0.4)];
  let use = good.filter((_, i) => speed[i] <= slowCut);
  if (use.length < 5) use = good;
  const as = use.map((p) => p.a);
  const bs = use.map((p) => p.b);
  const a = median(as);
  const b = median(bs);
  const sa = madSigma(as) / Math.sqrt(as.length);
  const sb = madSigma(bs) / Math.sqrt(bs.length);
  const wide = Math.max(a, b);
  const ratio = Math.min(a, b) / wide;
  const view: View = ratio >= 0.96 ? "side" : a < b ? "turned" : "tilted";
  const offDeg = (Math.acos(Math.min(1, ratio)) * 180) / Math.PI;
  const edge = 0.4; // px: where the strongest edge sits vs the plate's true edge (a rounded rim)
  const viewY = view === "tilted" ? 0.4 * (1 - ratio) : view === "turned" ? 0.05 * (1 - ratio) : 0;
  const viewX = view === "turned" ? 0.25 * (1 - ratio) : view === "tilted" ? 0.1 * (1 - ratio) : 0;
  const relErr = Math.sqrt(plate.rel ** 2 + (sb / b) ** 2 + (edge / b) ** 2 + viewY ** 2);
  const relErrX = Math.sqrt(plate.rel ** 2 + (sa / a) ** 2 + (edge / a) ** 2 + viewX ** 2);
  const out = {
    ...base,
    mmPerPxX: plate.mm / (2 * a),
    mmPerPxY: plate.mm / (2 * b),
    a,
    b,
    ratio,
    view,
    offDeg,
    relErr,
    relErrX,
  };
  if (wide < 8) return { ...out, ok: false, why: "plate_too_small" };
  if (ratio < 0.7) return { ...out, ok: false, why: "not_side_on" };
  return { ...out, ok: true, why: "ok" };
}

/** The scale from the plate's outer edge, measured in still frames (the engine's own way since bar-path/3). */
function fromSize(plate: PlateSize, size: RimSizeInput): Calibration {
  const { a, b } = size;
  const wide = Math.max(a, b);
  const ratio = Math.min(a, b) / wide;
  if (size.edgeOn) {
    const out: Calibration = {
      ok: true,
      plateMm: plate.mm,
      mmPerPxX: plate.mm / (2 * b),
      mmPerPxY: plate.mm / (2 * b),
      a,
      b,
      ratio,
      view: "front",
      offDeg: 90,
      relErr: Math.sqrt(plate.rel ** 2 + size.relB ** 2 + EDGE_ON_REL ** 2),
      // sideways the bar's path front-on is its width across the lifter, scaled like its height
      relErrX: Math.sqrt(plate.rel ** 2 + size.relB ** 2 + 0.1 ** 2),
      frames: size.frames,
      why: "ok",
      faint: size.faint,
    };
    return b < 8 ? { ...out, ok: false, why: "plate_too_small" } : out;
  }
  const view: View = ratio >= 0.96 ? "side" : a < b ? "turned" : "tilted";
  const offDeg = (Math.acos(Math.min(1, ratio)) * 180) / Math.PI;
  const viewY = view === "tilted" ? 0.4 * (1 - ratio) : view === "turned" ? 0.05 * (1 - ratio) : 0;
  const viewX = view === "turned" ? 0.25 * (1 - ratio) : view === "tilted" ? 0.1 * (1 - ratio) : 0;
  const out: Calibration = {
    ok: true,
    plateMm: plate.mm,
    mmPerPxX: plate.mm / (2 * a),
    mmPerPxY: plate.mm / (2 * b),
    a,
    b,
    ratio,
    view,
    offDeg,
    relErr: Math.sqrt(plate.rel ** 2 + size.relB ** 2 + viewY ** 2),
    relErrX: Math.sqrt(plate.rel ** 2 + size.relA ** 2 + viewX ** 2),
    frames: size.frames,
    why: "ok",
    faint: size.faint,
  };
  if (wide < 8) return { ...out, ok: false, why: "plate_too_small" };
  if (ratio < 0.7) return { ...out, ok: false, why: "not_side_on" };
  return out;
}
