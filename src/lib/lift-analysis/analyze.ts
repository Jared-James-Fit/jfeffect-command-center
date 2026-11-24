/**
 * The whole read of one set video, from the plate's track (pure): the scale
 * from the plate, the smoothed path, the reps and their numbers, the set's
 * numbers (velocity loss, depth and path consistency), what limits the
 * reading, and a compact copy of the path for drawing it over the video.
 */
import {
  calibrate,
  DEFAULT_PLATE,
  type Calibration,
  type PlateSize,
  type RimSizeInput,
  type View,
} from "@/lib/lift-analysis/calibrate";
import { lostStretches, type TrackKey } from "@/lib/lift-analysis/keyed";
import { madSigma, median } from "@/lib/lift-analysis/image";
import {
  analyzeReps,
  bandwidthFor,
  boundaryBandwidthFor,
  bridgeGaps,
  loess,
  metric,
  NONE,
  type IgnoredRise,
  type Metric,
  type RepMetrics,
  type Tier,
} from "@/lib/lift-analysis/kinematics";
import { packTrack } from "@/lib/lift-analysis/raw-track";
import type { TrackPoint } from "@/lib/lift-analysis/track";
import { velocityVerdict, type VelocityVerdict } from "@/lib/lift-analysis/verdict";

export const ENGINE_VERSION = "bar-path/6";

/**
 * The packed track is ~40 characters a frame once stored; past this many
 * frames (100 s at 60 fps) it's left off so a read stays well inside the
 * server's 600 KB cap (that read just can't have a rep taken out in place).
 */
export const RAW_MAX_FRAMES = 6000;

export type SetMetrics = {
  reps: number;
  completeReps: number;
  firstMcv: Metric;
  bestMcv: Metric;
  lastMcv: Metric;
  meanMcv: Metric;
  /** (fastest − last) ÷ fastest, % — needs no calibration (the camera's distance cancels). */
  velocityLoss: Metric;
  /** How far apart the reps' bottoms were (mm): depth consistency, for lifts lowered first. */
  depthSpread: Metric;
  /** Average sideways distance of each rep's path from the set's average path (mm). */
  pathSpread: Metric;
  romMean: Metric;
};

export type QualityNote =
  | "not_calibrated"
  | "plate_size_assumed"
  | "low_fps"
  | "camera_turned"
  | "camera_tilted"
  | "camera_moved"
  | "plate_small"
  | "plate_hidden"
  | "no_reps"
  | "short_track"
  | "implausible_scale"
  /** The plate's outer edge barely showed (black plate on a black background): the scale is less certain. */
  | "plate_edge_faint"
  /** The plate was lost for a stretch inside the set (shown for the athlete to fix). */
  | "tracking_gaps"
  /** A rise after the set, never seen coming back down, wasn't counted as a rep. */
  | "after_set"
  /** The athlete took out a rise that isn't a rep. */
  | "reps_edited";

export type LiftAnalysis = {
  engine: string;
  units: "mm" | "px";
  fps: number;
  /** The size frames were analysed at (px), for drawing. */
  frame: { w: number; h: number };
  window: { start: number; end: number };
  plate: {
    mm: number;
    confirmed: boolean;
    source: "auto" | "tap";
    /** Where it was found (analysed frame px) and when. */
    x: number;
    y: number;
    r: number;
    t: number;
    ratio: number;
    view: View;
    offDeg: number;
  };
  calibration: { ok: boolean; relErr: number; why: Calibration["why"]; mmPerPxY: number | null };
  dir: "lower_first" | "lift_first" | null;
  reps: RepMetrics[];
  set: SetMetrics;
  quality: { tracked: number; notes: QualityNote[] };
  /** Whether the set-average MCV is good enough to log as the set's velocity (verdict.ts). */
  velocity: VelocityVerdict;
  /** The smoothed path for drawing: times, x / y as shares of the frame (0…1), velocity (m/s, or null), tracked flags. */
  series: { t: number[]; x: number[]; y: number[]; v: (number | null)[]; ok: number[] };
  /**
   * What the read was followed from, so it can be read again (a correction
   * added) without asking again: the keys (frames where the plate's centre
   * and edge were known, analysed px), and the stretches inside the set
   * where the plate wasn't followed. Older reads have none.
   */
  track?: {
    keys: TrackKey[];
    lost: { start: number; end: number }[];
    /** Frames where following forward and backward disagreed (left out, never guessed). */
    conflicts: number;
    /** Frames got back by reading lost stretches again from both ends. */
    recovered?: number;
    /** The whole followed track, packed (raw-track.ts), and what reading it needs: read again with no video. */
    raw?: string;
    reread?: {
      size: RimSizeInput | null;
      shake: number | null;
      dirHint: "lower_first" | "lift_first" | null;
    };
  };
  /** Rises the athlete said aren't reps (when each concentric started, s). */
  exclude?: number[];
  /** Rises left out of the reps, and why. */
  ignored?: IgnoredRise[];
};

export type AnalyzeOptions = {
  plate?: PlateSize & { confirmed?: boolean };
  source: "auto" | "tap";
  seed: { x: number; y: number; r: number; t: number };
  frame: { w: number; h: number };
  dirHint?: "lower_first" | "lift_first";
  /** Per-frame camera shift (px), when it was measured. */
  shake?: number[];

  /** The plate's size from its outer edge in still frames (rim-outer.ts), when measured. */
  size?: RimSizeInput | null;
  keys?: TrackKey[];
  conflicts?: number;
  /** Frames got back by reading lost stretches again from both ends (recover.ts). */
  recovered?: number;
  /** Rises the athlete said aren't reps (when each concentric started, s). */
  exclude?: number[];
  /** Keep the followed track on the read (packed) so it can be read again without the video. */
  keepRaw?: boolean;
};

const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/** Typical frame rate from the timestamps (median interval). */
export function frameRate(times: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++)
    if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  const m = median(d);
  return m > 0 ? 1 / m : 30;
}

function tierOfShare(share: number, measured: number, estimate: number): Tier | null {
  if (share <= measured) return "measured";
  if (share <= estimate) return "estimated";
  return null;
}

/**
 * A loaded barbell never travels more than about a metre in one rep or
 * moves faster than ~3.5 m/s; numbers past that mean the "plate" wasn't a
 * standard plate (a smaller one, or something else round), so the scale
 * is dropped rather than shown.
 */
export const MAX_REP_ROM_MM = 1100;
/** The least position noise a margin assumes (px): a small plate's sub-pixel jitter. */
export const MARGIN_FLOOR_PX = 0.13;
export const MAX_PEAK_M_S = 3.5;
/** Velocity loss is a measurement within ± this many percentage points (95 %), an estimate within VL_ESTIMATE_PTS, else not shown. */
export const VL_MEASURED_PTS = 4;
export const VL_ESTIMATE_PTS = 7;

export function analyzeTrack(points: TrackPoint[], opts: AnalyzeOptions): LiftAnalysis {
  const plate = opts.plate ?? { ...DEFAULT_PLATE, confirmed: false };
  const first = readTrack(points, opts, plate, plate.confirmed === true);
  const implausible =
    first.units === "mm" &&
    first.reps.some((r) => r.top - r.bottom > MAX_REP_ROM_MM || (r.peak.v ?? 0) > MAX_PEAK_M_S);
  const used = implausible ? readTrack(points, opts, plate, false) : first;
  return finish(points, opts, plate, used, implausible);
}

type Read = ReturnType<typeof readTrack>;

function readTrack(
  points: TrackPoint[],
  opts: AnalyzeOptions,
  plate: PlateSize & { confirmed?: boolean },
  allowScale: boolean,
) {
  const cal0 = calibrate(points, plate, opts.size);
  const cal: Calibration = allowScale ? cal0 : { ...cal0, ok: false };
  const times = points.map((p) => p.t);
  const fps = frameRate(times);
  const found = points.map((p) => p.found);
  const units: "mm" | "px" = cal.ok ? "mm" : "px";
  // vertical up, in mm when calibrated
  const sy = cal.ok ? cal.mmPerPxY : 1;
  const sxs = cal.ok ? cal.mmPerPxX : 1;
  // a tilted phone: the plate (and the bar's travel with it) bigger at one end of the rep. Heights are
  // remapped so one scale fits all of them: y' = y0 + (b/k)·ln(1 + k(y − y0)/b), the integral of b / b(y)
  const grad = cal.ok && opts.size?.grad ? opts.size.grad : null;
  const level = (y: number) => {
    if (!grad || !(cal.b > 0)) return y;
    const u = 1 + (grad.k * (y - grad.y0)) / cal.b;
    return u > 0.2 ? grad.y0 + (cal.b / grad.k) * Math.log(u) : y;
  };
  const across = (y: number) =>
    grad && cal.b > 0 ? cal.b / Math.max(0.2 * cal.b, cal.b + grad.k * (y - grad.y0)) : 1;
  const Y = points.map((p) => -level(p.y) * sy);
  const X = points.map((p) => p.x * sxs * across(p.y));
  const w = points.map((p) => (p.found ? Math.max(0.2, p.conf) : 0));
  const h = bandwidthFor(fps);
  const s = loess(times, Y, w, h);
  const sxSm = loess(times, X, w, h);
  const sb = loess(times, Y, w, boundaryBandwidthFor(fps));
  // the plate hidden for a moment (someone walking past): bridged, so the rep still counts
  const bridged = bridgeGaps(s, 1.2);
  bridgeGaps(sb, 1.2);
  bridgeGaps(sxSm, 1.2);
  // the raw position noise, from what the smoothing took off (its own dof corrected)
  const res: number[] = [];
  for (let i = 0; i < points.length; i++) if (found[i] && s.ok[i]) res.push(Y[i] - s.y[i]);
  const sigmaMove = Math.max(madSigma(res) * 1.25, cal.ok ? 0.3 : 0.05);
  // the margins: never better than an eighth of a pixel. Following a plate's picture jitters by about
  // that much frame to frame however smooth the path looks, and on a small plate that's millimetres
  const sigmaRaw = Math.max(sigmaMove, cal.ok ? MARGIN_FLOOR_PX * sy : MARGIN_FLOOR_PX);
  const minRom = cal.ok ? 60 : 6 * sigmaMove;
  const ignored: IgnoredRise[] = [];
  const reps = analyzeReps({
    raw: { t: times, y: Y, found },
    s,
    sb,
    sx: sxSm,
    sigma: sigmaRaw,
    sigmaMove,
    fps,
    scale: {
      ok: cal.ok,
      mmPerPxY: cal.mmPerPxY,
      mmPerPxX: cal.mmPerPxX,
      relErr: cal.relErr,
      relErrX: cal.relErrX,
    },
    units,
    found,
    bridged,
    dirHint: opts.dirHint,
    minRom,
    exclude: opts.exclude,
    ignored,
  });
  return { cal, times, fps, found, units, sy, sxs, s, sxSm, sigmaRaw, reps, bridged, ignored };
}

function finish(
  points: TrackPoint[],
  opts: AnalyzeOptions,
  plate: PlateSize & { confirmed?: boolean },
  read: Read,
  implausible: boolean,
): LiftAnalysis {
  const { cal, times, fps, found, units, sy, sxs, s, sxSm, sigmaRaw, reps, bridged, ignored } =
    read;
  const notes = new Set<QualityNote>();
  if (ignored.some((g) => g.why === "after_set")) notes.add("after_set");
  if (ignored.some((g) => g.why === "athlete")) notes.add("reps_edited");
  if (implausible) notes.add("implausible_scale");
  if (!cal.ok) notes.add("not_calibrated");
  if (cal.ok && cal.faint) notes.add("plate_edge_faint");
  if (cal.ok && !plate.confirmed) notes.add("plate_size_assumed");
  if (fps < 50) notes.add("low_fps");
  if (cal.ok && cal.view === "turned" && cal.ratio < 0.96) notes.add("camera_turned");
  if (cal.ok && cal.view === "tilted" && cal.ratio < 0.96) notes.add("camera_tilted");
  if (Number.isFinite(cal.b) && cal.b < 18) notes.add("plate_small");
  if (!reps.length) notes.add("no_reps");
  if (reps.some((r) => r.coverage < 0.75)) notes.add("plate_hidden");
  const shakes = opts.shake ?? [];
  if (shakes.length && median(shakes) > 1.5) notes.add("camera_moved");
  // a moving camera moves the plate too: every speed is then an estimate at best
  const moved = notes.has("camera_moved");
  if (moved) {
    for (const r of reps) {
      for (const k of ["mcv", "peak", "mpv", "rom", "eccSpeed", "xShift", "xDev"] as const) {
        const m = r[k];
        if (m.tier === "measured")
          (r as Record<string, unknown>)[k] = { ...m, tier: "estimated", why: "camera_moved" };
      }
    }
  }

  // the set
  const complete = reps.filter((r) => r.complete);
  const withV = complete.filter((r) => r.mcv.v != null && r.mcv.tier !== "unavailable");
  const first = withV[0];
  const last = withV[withV.length - 1];
  const best = withV.reduce<RepMetrics | null>(
    (b, r) => (!b || (r.mcv.v ?? 0) > (b.mcv.v ?? 0) ? r : b),
    null,
  );
  // the set's average only when every rep of it was read: a partial set is never called the set
  const whole = reps.length > 0 && withV.length === reps.length;
  const mean = whole
    ? (() => {
        const v = withV.reduce((sum, r) => sum + (r.mcv.v ?? 0), 0) / withV.length;
        const u = Math.sqrt(withV.reduce((sum, r) => sum + (r.mcv.u ?? 0) ** 2, 0)) / withV.length;
        // the scale's share doesn't average out
        const uScale = 2 * cal.relErr * v;
        const u95 = Math.hypot(u, uScale);
        const tier = tierOfShare(u95 / v, 0.08, 0.25);
        return tier ? ({ v, u: u95, tier } as Metric) : NONE("too_uncertain");
      })()
    : NONE(units !== "mm" ? "not_calibrated" : reps.length ? "partial_set" : "no_reps");

  // velocity loss from the raw rise / time of each rep: the scale cancels, so it works without calibration
  const raw = complete.map((r) => {
    const D = r.top - r.bottom;
    const T = r.con.end - r.con.start;
    const rel = r.mcv.v != null && r.mcv.u != null ? r.mcv.u / 2 / r.mcv.v : 0.04;
    return {
      speed: D / T,
      rel: Math.sqrt(Math.max(0, rel ** 2 - (units === "mm" ? cal.relErr ** 2 : 0))),
      r,
    };
  });
  let velocityLoss: Metric = NONE(complete.length < 2 ? "one_rep" : "not_measurable");
  // only from a set whose every rep was read: the fastest or the last could be the one that wasn't
  const everyRepRead = complete.every((r) =>
    units === "mm" ? r.mcv.tier !== "unavailable" && r.mcv.v != null : r.coverage >= 0.75,
  );
  if (raw.length >= 2 && !everyRepRead) velocityLoss = NONE("partial_set");
  else if (raw.length >= 2) {
    const fastest = raw.reduce((b, x) => (x.speed > b.speed ? x : b));
    const lastR = raw[raw.length - 1];
    const ratio = lastR.speed / fastest.speed;
    const vl = (1 - ratio) * 100;
    const sd = ratio * Math.hypot(fastest.rel, lastR.rel) * 100;
    const u95 = 2 * sd;
    // a few points either way changes what velocity loss says (a 10 % or 20 % stop); wider than
    // that it can't tell a fresh set from a hard one, so it isn't shown
    const tier: Tier | null =
      u95 <= VL_MEASURED_PTS ? "measured" : u95 <= VL_ESTIMATE_PTS ? "estimated" : null;
    velocityLoss = tier
      ? { v: vl, u: u95, tier, ...(moved ? { why: "camera_moved" } : {}) }
      : NONE("too_uncertain");
    if (moved && velocityLoss.tier === "measured")
      velocityLoss = { ...velocityLoss, tier: "estimated" };
  }

  let depthSpread: Metric = NONE(units !== "mm" ? "not_calibrated" : "one_rep");
  let pathSpread: Metric = NONE(units !== "mm" ? "not_calibrated" : "one_rep");
  let romMean: Metric = NONE(units !== "mm" ? "not_calibrated" : "no_reps");
  if (units === "mm" && complete.length) {
    const romV = complete.reduce((sum, r) => sum + (r.top - r.bottom), 0) / complete.length;
    romMean = metric(romV, cal.relErr);
  }
  if (units === "mm" && complete.length >= 2) {
    const bottoms = complete.map((r) => r.bottom);
    const spread = Math.max(...bottoms) - Math.min(...bottoms);
    const noise = 2 * sigmaRaw;
    if (complete[0].dir === "lower_first")
      depthSpread = metric(spread, 0, { abs: Math.hypot(noise, 2) / 2 });
    // each rep's sideways path at 10 heights, from its own start
    const paths = complete.map((r) => {
      const pts: number[] = [];
      const x0 = sxValueAt(sxSm, r.con.start);
      for (let k = 1; k <= 9; k++) {
        const target = r.bottom + ((r.top - r.bottom) * k) / 10;
        const tAt = timeAtHeight(s, r.con.start, r.con.end, target);
        pts.push(tAt == null ? NaN : sxValueAt(sxSm, tAt) - x0);
      }
      return pts;
    });
    const meanPath = Array.from({ length: 9 }, (_, k) => {
      const vals = paths.map((p) => p[k]).filter(Number.isFinite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
    });
    const rms = paths
      .map((p) => {
        const d = p.map((v, k) => v - meanPath[k]).filter(Number.isFinite);
        return d.length ? Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length) : NaN;
      })
      .filter(Number.isFinite);
    if (rms.length >= 2) {
      const v = rms.reduce((a, b) => a + b, 0) / rms.length;
      pathSpread = metric(v, 0, { abs: Math.hypot(sigmaRaw * 0.7, 1.5) });
      if (cal.view === "turned" && cal.ratio < 0.96)
        pathSpread = { ...pathSpread, tier: "estimated", why: "camera_turned" };
    }
  }

  const tracked = points.length ? found.filter(Boolean).length / points.length : 0;
  if (points.length < 20) notes.add("short_track");
  // the stretches inside the set (first rep's start to last rep's end) where the plate wasn't followed
  const setFrom = reps.length
    ? Math.min(...reps.map((r) => r.ecc?.start ?? r.con.start))
    : times[0];
  const setTo = reps.length
    ? Math.max(...reps.map((r) => Math.max(r.con.end, r.ecc?.end ?? 0)))
    : times[times.length - 1];
  const lost = lostStretches(points, setFrom, setTo, Math.max(3, Math.round(fps * 0.1)));
  if (lost.length) notes.add("tracking_gaps");
  const startT = reps.length
    ? Math.max(times[0], (reps[0].ecc?.start ?? reps[0].con.start) - 0.5)
    : times[0];
  const lastRep = reps[reps.length - 1];
  const endT = reps.length
    ? Math.min(times[times.length - 1], Math.max(lastRep.con.end, lastRep.ecc?.end ?? 0) + 0.5)
    : times[times.length - 1];

  const series = {
    t: times.map((t) => round(t, 3)),
    x: points.map((p, i) => round((sxSm.ok[i] ? sxSm.y[i] / sxs : p.x) / opts.frame.w, 4)),
    y: points.map((p, i) => round((s.ok[i] ? -s.y[i] / sy : p.y) / opts.frame.h, 4)),
    v: points.map((_, i) =>
      units === "mm" && s.ok[i] && !bridged[i] ? round(s.v[i] / 1000, 3) : null,
    ),
    ok: points.map((p, i) => (p.found && s.ok[i] ? 1 : 0)),
  };

  const out: Omit<LiftAnalysis, "velocity"> = {
    engine: ENGINE_VERSION,
    units,
    fps: round(fps, 2),
    frame: opts.frame,
    window: { start: round(startT, 3), end: round(endT, 3) },
    plate: {
      mm: plate.mm,
      confirmed: !!plate.confirmed,
      source: opts.source,
      x: round(opts.seed.x, 2),
      y: round(opts.seed.y, 2),
      r: round(opts.seed.r, 2),
      t: round(opts.seed.t, 3),
      ratio: Number.isFinite(cal.ratio) ? round(cal.ratio, 3) : 1,
      view: cal.view,
      offDeg: round(cal.offDeg, 1),
    },
    calibration: {
      ok: cal.ok,
      relErr: Number.isFinite(cal.relErr) ? round(cal.relErr, 4) : 1,
      why: cal.why,
      mmPerPxY: cal.ok ? round(cal.mmPerPxY, 4) : null,
    },
    dir: reps[0]?.dir ?? null,
    reps,
    set: {
      reps: reps.length,
      completeReps: complete.length,
      firstMcv: first ? first.mcv : NONE(units === "mm" ? "no_reps" : "not_calibrated"),
      bestMcv: best ? best.mcv : NONE(units === "mm" ? "no_reps" : "not_calibrated"),
      lastMcv: last ? last.mcv : NONE(units === "mm" ? "no_reps" : "not_calibrated"),
      meanMcv: mean,
      velocityLoss,
      depthSpread,
      pathSpread,
      romMean,
    },
    quality: { tracked: round(tracked, 3), notes: [...notes] },
    series,
    ...(opts.keys
      ? {
          track: {
            keys: opts.keys.map((k) => ({
              ...k,
              t: round(k.t, 4),
              x: round(k.x, 2),
              y: round(k.y, 2),
              a: round(k.a, 2),
              b: round(k.b, 2),
            })),
            lost: lost.map((l) => ({ start: round(l.start, 3), end: round(l.end, 3) })),
            conflicts: opts.conflicts ?? 0,
            recovered: opts.recovered ?? 0,
            ...(opts.keepRaw === false || points.length > RAW_MAX_FRAMES
              ? {}
              : {
                  raw: packTrack(points),
                  reread: {
                    size: opts.size ?? null,
                    shake: opts.shake?.length ? median(opts.shake) : null,
                    dirHint: opts.dirHint ?? null,
                  },
                }),
          },
        }
      : {}),
    ...(opts.exclude?.length ? { exclude: opts.exclude.map((t) => round(t, 3)) } : {}),
    ...(ignored.length ? { ignored: ignored.map((g) => ({ ...g, t: round(g.t, 3) })) } : {}),
  };
  return { ...out, velocity: velocityVerdict(out as LiftAnalysis) };
}

function sxValueAt(sx: { t: number[]; y: number[] }, time: number): number {
  const t = sx.t;
  let i = 0;
  while (i < t.length - 1 && t[i + 1] < time) i++;
  const j = Math.min(t.length - 1, i + 1);
  const f = t[j] > t[i] ? (time - t[i]) / (t[j] - t[i]) : 0;
  return sx.y[i] + (sx.y[j] - sx.y[i]) * Math.max(0, Math.min(1, f));
}

/** When the rising bar first passed a height, inside the concentric. */
function timeAtHeight(
  s: { t: number[]; y: number[]; ok: boolean[] },
  t0: number,
  t1: number,
  target: number,
): number | null {
  for (let i = 1; i < s.t.length; i++) {
    if (s.t[i] < t0 || s.t[i - 1] > t1) continue;
    if (!s.ok[i] || !s.ok[i - 1]) continue;
    if (s.y[i - 1] <= target && s.y[i] >= target) {
      const f = s.y[i] !== s.y[i - 1] ? (target - s.y[i - 1]) / (s.y[i] - s.y[i - 1]) : 0;
      return s.t[i - 1] + f * (s.t[i] - s.t[i - 1]);
    }
  }
  return null;
}
