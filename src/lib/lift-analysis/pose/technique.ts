/**
 * Technique, read from the body's track and the bar's own read (pure, tested).
 *
 * Every number here is what the picture shows, said as such: joint angles in
 * the picture's plane, only from a side-on camera (`viewOf`), only from joints
 * the model saw well (`VIS_MIN`), and taken at the moments the bar's read
 * marks (the bottom of a squat or bench, the bar leaving the floor in a
 * deadlift), so the body and the bar agree on what happened when. A front or
 * rear camera reads side-to-side movement instead of angles. Distances on the
 * body come from the plate's scale, which sits nearer the camera than the
 * lifter, so they're only ever approximate (≈) and rounded to whole cm; the
 * angles don't depend on scale. Observations are patterns a coach can look
 * at, with the rep and moment to jump to: never a diagnosis, never "wrong" or
 * "dangerous", and none without the numbers behind it.
 */
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { GuideLift } from "@/lib/lift-analysis/exercise";
import {
  anglesOf,
  facing,
  frameAt,
  J,
  nearSide,
  poseCoverage,
  seen,
  sideJoints,
  viewOf,
  type CameraView,
  type JointAngles,
  type PoseTrack,
  type Side,
} from "@/lib/lift-analysis/pose/skeleton";

/** An angle difference between reps under this (°) is within what the model itself wanders. */
export const ANGLE_NOISE_DEG = 6;
/** The share of the concentric whose start is read for "what moved first". */
export const EARLY_DRIVE = 0.35;

export type RepTechnique = {
  n: number;
  /** Times to jump to: the rep's start, its turnaround (bottom / bar off the floor), its end. */
  at: { start: number; turn: number; end: number };
  /** Named numbers for this rep (null: not seen well enough). */
  m: Record<string, number | null>;
};

export type Observation = {
  id: string;
  text: string;
  /** Where to look: a time in the clip, and the rep. */
  t: number | null;
  rep: number | null;
};

export type MetricRow = {
  key: string;
  label: string;
  unit: "°" | "cm" | "%";
  /** "≈": an estimate from the plate's scale. */
  approx?: boolean;
  /** How to read it, one line. */
  hint: string;
};

export type TechniqueRead = {
  lift: GuideLift;
  view: CameraView;
  side: Side | null;
  facing: 1 | -1 | null;
  coverage: number;
  /** Sagittal angles can be shown (side-on camera, a near side). */
  angles: boolean;
  rows: MetricRow[];
  reps: RepTechnique[];
  observations: Observation[];
  /** What this video can't show, in plain words. */
  limits: string[];
};

const ROWS: Record<GuideLift, MetricRow[]> = {
  squat: [
    {
      key: "depth",
      label: "Depth (thigh)",
      unit: "°",
      hint: "Hip joint against the knee joint at the bottom: + below parallel, − above. Judges look at the hip crease and the top of the knee, so treat this as a guide.",
    },
    { key: "torsoBottom", label: "Torso lean at the bottom", unit: "°", hint: "From vertical." },
    {
      key: "torsoDrive",
      label: "Torso lean change, early drive",
      unit: "°",
      hint: "How much further the torso leaned in the first third of the way up: + hips rose before the chest.",
    },
    { key: "kneeBottom", label: "Knee bend at the bottom", unit: "°", hint: "0 = straight." },
    {
      key: "shinBottom",
      label: "Shin angle at the bottom",
      unit: "°",
      hint: "From vertical: how far the knees travelled forward.",
    },
  ],
  bench: [
    { key: "elbowTouch", label: "Elbow bend at the touch", unit: "°", hint: "0 = straight." },
    {
      key: "forearmTouch",
      label: "Forearm at the touch",
      unit: "°",
      hint: "Wrist-to-elbow line from vertical: 0 = stacked under the bar.",
    },
    {
      key: "touchFromShoulder",
      label: "Touch point from the shoulder",
      unit: "cm",
      approx: true,
      hint: "Along the body, toward the feet. From the plate's scale: approximate.",
    },
  ],
  deadlift: [
    { key: "hipStart", label: "Hip bend off the floor", unit: "°", hint: "0 = standing straight." },
    { key: "torsoStart", label: "Torso lean off the floor", unit: "°", hint: "From vertical." },
    { key: "shinStart", label: "Shin angle off the floor", unit: "°", hint: "From vertical." },
    {
      key: "hipRise",
      label: "Hips against the bar, early pull",
      unit: "%",
      hint: "How far the hips rose for each 100 the bar rose in the first third of the pull: over 100, the hips came up first.",
    },
    {
      key: "kneesStraight",
      label: "Knees straight at",
      unit: "%",
      hint: "Share of the pull when the knees finished straightening.",
    },
    {
      key: "barToShin",
      label: "Bar from the shin off the floor",
      unit: "cm",
      approx: true,
      hint: "From the plate's scale: approximate.",
    },
  ],
  other: [],
};

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Angles averaged over the frames within `half` s of t (a frame's own wobble smoothed out). */
function anglesNear(
  track: PoseTrack,
  side: Side,
  t: number,
  half = 0.05,
): JointAngles & { n: number } {
  const list: JointAngles[] = [];
  for (let i = 0; i < track.t.length; i++) {
    if (Math.abs(track.t[i] - t) <= half && track.frames[i])
      list.push(anglesOf(track.frames[i], side, track.frame));
  }
  if (!list.length) {
    const f = frameAt(track, t);
    if (f) list.push(anglesOf(f, side, track.frame));
  }
  const pick = (k: keyof JointAngles) => avg(list.map((a) => a[k]));
  return {
    knee: pick("knee"),
    hip: pick("hip"),
    elbow: pick("elbow"),
    torso: pick("torso"),
    shin: pick("shin"),
    thigh: pick("thigh"),
    n: list.length,
  };
}

/** A joint's y (frame px) at time t, when seen. */
function jointY(track: PoseTrack, j: number, t: number): number | null {
  const p = seen(frameAt(track, t), j);
  return p ? p.y * track.frame.h : null;
}

/**
 * The bar's (plate's) position at time t, when it was followed, in the body track's pixels: the bar
 * read's series are shares of its own (smaller, working-size) frame, the body's landmarks of the clip
 * as shown, so both are put in the track's frame before they're compared.
 */
function barAt(a: LiftAnalysis, t: number, frame: { w: number; h: number }): { x: number; y: number } | null {
  const { t: ts, x, y, ok } = a.series;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < ts.length; i++) {
    const d = Math.abs(ts[i] - t);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0 || bd > 0.1 || !ok[best]) return null;
  return { x: x[best] * frame.w, y: y[best] * frame.h };
}

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

export function readTechnique(raw: PoseTrack, a: LiftAnalysis, lift: GuideLift): TechniqueRead {
  const track = raw;
  const view = viewOf(track);
  const side = nearSide(track);
  const face = side ? facing(track, side) : null;
  const coverage = poseCoverage(track);
  const angles = view === "side" && side != null;
  const limits: string[] = [];
  if (coverage < 0.6)
    limits.push(
      "The body was found in under 60% of the frames: numbers are left out where it wasn't.",
    );
  if (view === "front")
    limits.push(
      "Filmed from the front or behind: joint angles need a side view. Side-to-side movement is shown instead.",
    );
  else if (view === "oblique")
    limits.push(
      "Filmed at an angle: joint angles would be distorted, so they aren't shown. A side view reads them.",
    );
  else if (view === "unknown")
    limits.push("The body wasn't seen well enough to tell where the camera was.");
  if (lift === "other") limits.push("Lift-specific reads are for the squat, bench and deadlift.");

  // track pixels → mm at the plate's distance (the body is further away: approximate); the bar read's
  // scale is per pixel of its own working frame, the same picture at a.frame.h / track.frame.h the size
  const frameK = a.frame.h > 0 && track.frame.h > 0 ? a.frame.h / track.frame.h : 1;
  const mmPerPx = a.units === "mm" ? a.calibration.mmPerPxY * frameK : null;
  const mmToCm = (px: number | null) =>
    px == null || mmPerPx == null ? null : Math.round((px * mmPerPx) / 10);

  const reps: RepTechnique[] = a.reps.map((r) => {
    const lowerFirst = r.dir === "lower_first";
    const start = lowerFirst ? (r.ecc?.start ?? r.con.start) : r.con.start;
    const turn = r.con.start;
    const end = r.con.end;
    const m: Record<string, number | null> = {};
    if (angles && side) {
      const sj = sideJoints(side);
      const at0 = anglesNear(track, side, turn);
      const early = turn + EARLY_DRIVE * (end - turn);
      if (lift === "squat") {
        m.depth = r1(at0.thigh);
        m.torsoBottom = r1(at0.torso);
        m.kneeBottom = r1(at0.knee);
        m.shinBottom = r1(at0.shin);
        // the most the torso leaned beyond its bottom angle in the early drive
        let most: number | null = null;
        for (let i = 0; i < track.t.length; i++) {
          if (track.t[i] < turn || track.t[i] > early) continue;
          const v = anglesOf(track.frames[i], side, track.frame).torso;
          if (v != null) most = most == null ? v : Math.max(most, v);
        }
        m.torsoDrive = most != null && at0.torso != null ? r1(most - at0.torso) : null;
      } else if (lift === "bench") {
        m.elbowTouch = r1(at0.elbow);
        const f = frameAt(track, turn);
        const el = seen(f, sj.elbow);
        const wr = seen(f, sj.wrist);
        if (el && wr) {
          const dx = (wr.x - el.x) * track.frame.w;
          const dy = (el.y - wr.y) * track.frame.h;
          m.forearmTouch =
            Math.hypot(dx, dy) > 1e-6 ? r1((Math.atan2(Math.abs(dx), dy) * 180) / Math.PI) : null;
        } else m.forearmTouch = null;
        const sh = seen(f, sj.shoulder);
        const hp = seen(f, sj.hip);
        const bar = barAt(a, turn, track.frame);
        if (sh && hp && bar) {
          // along the body: positive toward the hips
          const dir = Math.sign(hp.x - sh.x) || 1;
          m.touchFromShoulder = mmToCm((bar.x - sh.x * track.frame.w) * dir);
        } else m.touchFromShoulder = null;
      } else if (lift === "deadlift") {
        m.hipStart = r1(at0.hip);
        m.torsoStart = r1(at0.torso);
        m.shinStart = r1(at0.shin);
        // hips against bar over the first third of the pull (both read in picture px)
        const hip0 = jointY(track, sj.hip, turn);
        const hip1 = jointY(track, sj.hip, early);
        const bar0 = barAt(a, turn, track.frame);
        const bar1 = barAt(a, early, track.frame);
        // the bar must have moved: 4 px of the bar read's working frame
        if (hip0 != null && hip1 != null && bar0 && bar1 && bar0.y - bar1.y > 4 / frameK)
          m.hipRise = Math.round(((hip0 - hip1) / (bar0.y - bar1.y)) * 100);
        else m.hipRise = null;
        // when the knees finished straightening (knee bend under 12°), as a share of the pull
        let straight: number | null = null;
        for (let i = 0; i < track.t.length; i++) {
          const t = track.t[i];
          if (t < turn || t > end) continue;
          const k = anglesOf(track.frames[i], side, track.frame).knee;
          if (k != null && k < 12) {
            straight = t;
            break;
          }
        }
        m.kneesStraight =
          straight != null && end > turn
            ? Math.round(((straight - turn) / (end - turn)) * 100)
            : null;
        // bar to shin at the bar's height, off the floor
        const f = frameAt(track, turn);
        const kn = seen(f, sj.knee);
        const an = seen(f, sj.ankle);
        if (kn && an && bar0 && Math.abs(kn.y - an.y) > 1e-4) {
          const k = (bar0.y / track.frame.h - an.y) / (kn.y - an.y);
          const shinX = (an.x + k * (kn.x - an.x)) * track.frame.w;
          m.barToShin = mmToCm(Math.abs(bar0.x - shinX));
        } else m.barToShin = null;
      }
    }
    if (view === "front") {
      // side-to-side: the hips' middle against the feet's middle at the bottom / off the floor, in hip widths
      const f = frameAt(track, turn);
      const lh = seen(f, J.lHip);
      const rh = seen(f, J.rHip);
      const la = seen(f, J.lAnkle);
      const ra = seen(f, J.rAnkle);
      if (lh && rh && la && ra) {
        const width = Math.abs(lh.x - rh.x);
        if (width > 0.01)
          m.hipShift = Math.round((((lh.x + rh.x) / 2 - (la.x + ra.x) / 2) / width) * 100);
      }
    }
    return { n: r.n, at: { start, turn, end }, m };
  });

  const rows = angles ? [...ROWS[lift]] : [];
  if (view === "front" && reps.some((r) => r.m.hipShift != null))
    rows.push({
      key: "hipShift",
      label: lift === "bench" ? "Hips against the feet" : "Hips against the feet",
      unit: "%",
      hint: "Middle of the hips against the middle of the feet, in hip widths: + toward the right of the picture. From the front this is the athlete's left; from behind, their right.",
    });

  return {
    lift,
    view,
    side,
    facing: face,
    coverage,
    angles,
    rows,
    reps,
    observations: observe(lift, reps, a, rows),
    limits,
  };
}

/**
 * Patterns across the reps worth a look, from the numbers above and the
 * bar's own read: a change from the first rep to the last beyond what the
 * model wanders (`ANGLE_NOISE_DEG`), the bar's sideways drift growing, the
 * start position moving. Each says what changed, by how much, and where.
 */
export function observe(
  lift: GuideLift,
  reps: RepTechnique[],
  a: LiftAnalysis,
  rows: MetricRow[],
): Observation[] {
  const out: Observation[] = [];
  const keys = new Set(rows.map((r) => r.key));
  const withV = (k: string) => reps.filter((r) => r.m[k] != null);
  const firstLast = (k: string) => {
    const v = withV(k);
    return v.length >= 2 ? [v[0], v[v.length - 1]] : null;
  };
  const deg = (v: number) => `${Math.round(Math.abs(v))}°`;

  if (lift === "squat" && keys.has("torsoDrive")) {
    const worst = withV("torsoDrive").reduce<RepTechnique | null>(
      (b, r) => (!b || r.m.torsoDrive! > b.m.torsoDrive! ? r : b),
      null,
    );
    if (worst && worst.m.torsoDrive! >= ANGLE_NOISE_DEG)
      out.push({
        id: "torso-drive",
        text: `Rep ${worst.n}: the torso leaned about ${deg(worst.m.torsoDrive!)} further in the first third of the drive (the hips rose before the chest).`,
        t: worst.at.turn,
        rep: worst.n,
      });
    const fl = firstLast("depth");
    if (fl && Math.abs(fl[1].m.depth! - fl[0].m.depth!) >= ANGLE_NOISE_DEG)
      out.push({
        id: "depth-change",
        text: `Depth changed about ${deg(fl[1].m.depth! - fl[0].m.depth!)} from rep ${fl[0].n} to rep ${fl[1].n} (${fl[1].m.depth! < fl[0].m.depth! ? "higher" : "deeper"}).`,
        t: fl[1].at.turn,
        rep: fl[1].n,
      });
    const ft = firstLast("torsoBottom");
    if (ft && Math.abs(ft[1].m.torsoBottom! - ft[0].m.torsoBottom!) >= ANGLE_NOISE_DEG)
      out.push({
        id: "torso-bottom-change",
        text: `Torso lean at the bottom went from about ${deg(ft[0].m.torsoBottom!)} on rep ${ft[0].n} to ${deg(ft[1].m.torsoBottom!)} on rep ${ft[1].n}.`,
        t: ft[1].at.turn,
        rep: ft[1].n,
      });
  }
  if (lift === "bench" && keys.has("touchFromShoulder")) {
    const v = withV("touchFromShoulder");
    if (v.length >= 2) {
      const xs = v.map((r) => r.m.touchFromShoulder!);
      const spread = Math.max(...xs) - Math.min(...xs);
      if (spread >= 4)
        out.push({
          id: "touch-spread",
          text: `The touch point moved about ${spread} cm along the body across the reps (≈, from the plate's scale).`,
          t: v[v.length - 1].at.turn,
          rep: v[v.length - 1].n,
        });
    }
    const fe = firstLast("forearmTouch");
    if (fe && Math.abs(fe[1].m.forearmTouch! - fe[0].m.forearmTouch!) >= ANGLE_NOISE_DEG)
      out.push({
        id: "forearm-change",
        text: `The forearm at the touch went from about ${deg(fe[0].m.forearmTouch!)} off vertical on rep ${fe[0].n} to ${deg(fe[1].m.forearmTouch!)} on rep ${fe[1].n}.`,
        t: fe[1].at.turn,
        rep: fe[1].n,
      });
  }
  if (lift === "deadlift" && keys.has("hipStart")) {
    const v = withV("hipStart");
    if (v.length >= 2) {
      const xs = v.map((r) => r.m.hipStart!);
      const spread = Math.max(...xs) - Math.min(...xs);
      if (spread >= ANGLE_NOISE_DEG)
        out.push({
          id: "start-spread",
          text: `The starting hip angle varied by about ${Math.round(spread)}° across the reps.`,
          t: v[xs.indexOf(Math.max(...xs))].at.turn,
          rep: v[xs.indexOf(Math.max(...xs))].n,
        });
    }
    const hr = withV("hipRise").filter((r) => r.m.hipRise! >= 160);
    if (hr.length)
      out.push({
        id: "hips-first",
        text: `Off the floor, the hips rose noticeably faster than the bar on rep${hr.length > 1 ? "s" : ""} ${hr.map((r) => r.n).join(", ")} (about ${Math.round((Math.max(...hr.map((r) => r.m.hipRise!)) / 100) * 10) / 10}× as fast).`,
        t: hr[0].at.turn,
        rep: hr[0].n,
      });
  }
  // the bar's own drift (measured from the plate, not the body)
  const drifts = a.reps
    .map((r) => ({ n: r.n, v: r.xDev.tier !== "unavailable" ? r.xDev.v : null, t: r.con.start }))
    .filter((d) => d.v != null);
  if (drifts.length >= 2 && a.units === "mm") {
    const f = drifts[0];
    const l = drifts[drifts.length - 1];
    if (l.v! - f.v! >= 20)
      out.push({
        id: "drift-grew",
        text: `The bar drifted more sideways as the set went on: about ${Math.round(f.v! / 10)} cm on rep ${f.n}, ${Math.round(l.v! / 10)} cm on rep ${l.n}.`,
        t: l.t,
        rep: l.n,
      });
  }
  return out;
}
