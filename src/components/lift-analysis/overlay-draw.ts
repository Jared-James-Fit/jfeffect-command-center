/**
 * What's drawn over a set video (canvas only, no React): the bar's path, the
 * athlete's skeleton, joint angles, reference lines, a second rep or the
 * start position as a faint ghost, and a coach's marks. The player draws it
 * on screen each frame; a saved frame draws the same thing at the clip's own
 * size, so a screenshot is exactly what was on screen.
 *
 * Every layer is its own switch. Joint angles and the torso and shin lines
 * are only drawn from a side-on camera (`TechniqueRead.angles`) and from
 * joints the model saw well; the skeleton is thin and quiet, the near side
 * brighter than the far one, so the video stays the thing being looked at.
 */
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import type { Shape } from "@/lib/lift-analysis/film-notes";
import {
  anglesOf,
  BONES,
  DOTS,
  DRAW_VIS_MIN,
  frameAt,
  J,
  point,
  seen,
  sideJoints,
  type CameraView,
  type PoseFrame,
  type PoseTrack,
  type Side,
} from "@/lib/lift-analysis/pose/skeleton";

export type Layers = {
  bar: boolean;
  skeleton: boolean;
  angles: boolean;
  vertical: boolean;
  segments: boolean;
  paths: boolean;
};

export const DEFAULT_LAYERS: Layers = {
  bar: true,
  skeleton: true,
  angles: true,
  vertical: false,
  segments: false,
  paths: false,
};

export type Compare = { kind: "rep"; rep: number } | { kind: "start" };

export type PoseScene = {
  track: PoseTrack;
  side: Side | null;
  view: CameraView;
  /** Sagittal angles can be drawn (side-on camera, a near side). */
  angles: boolean;
  layers: Layers;
  compare: Compare | null;
};

/** Map a frame share to the canvas. */
export type Project = (fx: number, fy: number) => [number, number];

export function repSpan(a: LiftAnalysis, i: number): { start: number; end: number } | null {
  const r = a.reps[i];
  if (!r) return null;
  const s = Math.min(r.con.start, r.ecc?.start ?? Infinity);
  const e = Math.max(r.con.end, r.ecc?.end ?? -Infinity);
  return { start: s, end: e };
}

/** Which rep a moment belongs to (the one it's in, else the last one before it). */
export function repAt(a: LiftAnalysis, t: number): number {
  let best = -1;
  for (let i = 0; i < a.reps.length; i++) {
    const sp = repSpan(a, i);
    if (!sp) continue;
    if (t >= sp.start - 0.25) best = i;
  }
  return best;
}

export function valueAt(t: number[], arr: (number | null)[], at: number): number | null {
  if (!t.length) return null;
  let lo = 0;
  let hi = t.length - 1;
  if (at <= t[0]) return arr[0];
  if (at >= t[hi]) return arr[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] <= at) lo = m;
    else hi = m;
  }
  const a = arr[lo];
  const b = arr[hi];
  if (a == null || b == null) return a ?? b;
  const f = (at - t[lo]) / (t[hi] - t[lo] || 1);
  return a + (b - a) * f;
}

/** A rep's phase boundaries in time order (start, turnaround, end). */
export function repPhases(a: LiftAnalysis, i: number): number[] | null {
  const r = a.reps[i];
  if (!r) return null;
  if (r.dir === "lower_first")
    return r.ecc ? [r.ecc.start, r.con.start, r.con.end] : [r.con.start, r.con.end];
  return r.ecc ? [r.con.start, r.con.end, r.ecc.end] : [r.con.start, r.con.end];
}

/**
 * The moment in rep `to` at the same point of the movement as `now` in rep
 * `from` (each phase stretched to fit: bottoms line up with bottoms).
 */
export function samePhaseTime(
  a: LiftAnalysis,
  from: number,
  to: number,
  now: number,
): number | null {
  const pa = repPhases(a, from);
  const pb = repPhases(a, to);
  if (!pa || !pb || pa.length !== pb.length) return null;
  if (now <= pa[0]) return pb[0];
  for (let k = 0; k < pa.length - 1; k++) {
    if (now <= pa[k + 1]) {
      const u = (now - pa[k]) / Math.max(1e-6, pa[k + 1] - pa[k]);
      return pb[k] + u * (pb[k + 1] - pb[k]);
    }
  }
  return pb[pb.length - 1];
}

/* ── the bar ─────────────────────────────────────────────────────────── */

export function drawBarPath(
  ctx: CanvasRenderingContext2D,
  a: LiftAnalysis,
  P: Project,
  now: number,
  opts: { selectedRep: number | null; playing: boolean; scale?: number },
) {
  const S = a.series;
  const k = opts.scale ?? 1;
  const current = opts.selectedRep ?? repAt(a, now);
  const line = (
    from: number,
    to: number,
    upTo: number,
    style: { w: number; color: string; shadow?: boolean },
  ) => {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const paths: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (let i = 0; i < S.t.length; i++) {
      if (S.t[i] < from || S.t[i] > to || S.t[i] > upTo) continue;
      if (!S.ok[i]) {
        if (cur.length) paths.push(cur);
        cur = [];
        continue;
      }
      cur.push(P(S.x[i], S.y[i]));
    }
    if (cur.length) paths.push(cur);
    for (const pass of style.shadow ? [0, 1] : [1]) {
      ctx.lineWidth = (pass === 0 ? style.w + 3 : style.w) * k;
      ctx.strokeStyle = pass === 0 ? "rgba(0,0,0,0.55)" : style.color;
      for (const p of paths) {
        if (p.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (let q = 1; q < p.length; q++) ctx.lineTo(p[q][0], p[q][1]);
        ctx.stroke();
      }
    }
  };
  a.reps.forEach((rep, i) => {
    const sp = repSpan(a, i);
    if (!sp) return;
    if (i === current) {
      // the rep on screen: drawn as far as the video has got (all of it when it's selected and paused before it)
      const upTo = opts.selectedRep === i && !opts.playing && now < sp.start ? sp.end : now;
      line(sp.start, sp.end, upTo, { w: 3, color: "#ffffff", shadow: true });
      if (rep.sticking && rep.sticking.time <= upTo) {
        const sx = valueAt(S.t, S.x, rep.sticking.time);
        const sy = valueAt(S.t, S.y, rep.sticking.time);
        if (sx != null && sy != null) {
          const [x, y] = P(sx, sy);
          dot(ctx, x, y, 5 * k, "#f59e0b", k);
        }
      }
    } else if (sp.end <= now || opts.selectedRep != null) {
      line(sp.start, sp.end, Infinity, { w: 2, color: "rgba(255,255,255,0.35)" });
    }
  });
  // the plate's spot now
  if (S.t.length && now >= S.t[0] && now <= S.t[S.t.length - 1]) {
    const x = valueAt(S.t, S.x, now);
    const y = valueAt(S.t, S.y, now);
    if (x != null && y != null) {
      const [px, py] = P(x, y);
      dot(ctx, px, py, 4.5 * k, "#ffffff", k);
    }
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, k = 1) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/* ── the body ────────────────────────────────────────────────────────── */

const FAR_ALPHA = 0.4;

function sideOf(j: number): Side | null {
  if (j < 11) return null;
  return j % 2 === 1 ? "left" : "right";
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  f: PoseFrame,
  P: Project,
  near: Side | null,
  opts: { k: number; ghost?: boolean },
) {
  const { k } = opts;
  ctx.lineCap = "round";
  const alphaFor = (j: number) => (near && sideOf(j) && sideOf(j) !== near ? FAR_ALPHA : 1);
  for (const pass of opts.ghost ? [1] : [0, 1]) {
    for (const [a, b] of BONES) {
      const pa = point(f, a);
      const pb = point(f, b);
      if (!pa || !pb || pa.v < DRAW_VIS_MIN || pb.v < DRAW_VIS_MIN) continue;
      const al = Math.min(alphaFor(a), alphaFor(b));
      const [x1, y1] = P(pa.x, pa.y);
      const [x2, y2] = P(pb.x, pb.y);
      if (pass === 0) {
        ctx.lineWidth = 3.5 * k;
        ctx.strokeStyle = `rgba(0,0,0,${0.35 * al})`;
        ctx.setLineDash([]);
      } else if (opts.ghost) {
        ctx.lineWidth = 1.8 * k;
        ctx.strokeStyle = `rgba(125,211,252,${0.8 * al})`;
        ctx.setLineDash([5 * k, 4 * k]);
      } else {
        ctx.lineWidth = 1.8 * k;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * al})`;
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  if (opts.ghost) return;
  for (const j of DOTS) {
    const p = point(f, j);
    if (!p || p.v < DRAW_VIS_MIN) continue;
    const [x, y] = P(p.x, p.y);
    const al = alphaFor(j);
    ctx.fillStyle = `rgba(255,255,255,${0.95 * al})`;
    ctx.strokeStyle = `rgba(0,0,0,${0.5 * al})`;
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.arc(x, y, 2.6 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Labels already drawn this frame (so the next one moves clear of them). */
let placed: { x: number; y: number; w: number; h: number }[] = [];

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y0: number,
  k: number,
  tone: "plain" | "ghost" = "plain",
) {
  ctx.font = `600 ${11.5 * k}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  const w = ctx.measureText(text).width + 10 * k;
  const h = 18 * k;
  const bx = x - w / 2;
  // clear of the labels already drawn: stepped down, then up, a label's height at a time
  const hits = (yy: number) =>
    placed.some(
      (p) =>
        Math.abs(p.x - x) < (p.w + w) / 2 + 2 * k && Math.abs(p.y - yy) < (p.h + h) / 2 + 2 * k,
    );
  let y = y0;
  for (const step of [0, 1, -1, 2, -2, 3, -3]) {
    if (!hits(y0 + step * (h + 3 * k))) {
      y = y0 + step * (h + 3 * k);
      break;
    }
  }
  placed.push({ x, y, w, h });
  const by = y - h / 2;
  ctx.fillStyle = tone === "ghost" ? "rgba(8,47,73,0.75)" : "rgba(0,0,0,0.62)";
  ctx.beginPath();
  const r = 6 * k;
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + w, by, bx + w, by + h, r);
  ctx.arcTo(bx + w, by + h, bx, by + h, r);
  ctx.arcTo(bx, by + h, bx, by, r);
  ctx.arcTo(bx, by, bx + w, by, r);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5 * k);
}

/** A small arc at a joint between two of its bones, and its angle beside it. */
function jointAngle(
  ctx: CanvasRenderingContext2D,
  P: Project,
  f: PoseFrame,
  a: number,
  b: number,
  c: number,
  value: number | null,
  k: number,
  name: string,
) {
  if (value == null) return;
  const pa = seen(f, a);
  const pb = seen(f, b);
  const pc = seen(f, c);
  if (!pa || !pb || !pc) return;
  const [ax, ay] = P(pa.x, pa.y);
  const [bx, by] = P(pb.x, pb.y);
  const [cx, cy] = P(pc.x, pc.y);
  const t1 = Math.atan2(ay - by, ax - bx);
  const t2 = Math.atan2(cy - by, cx - bx);
  let d = t2 - t1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const r = 16 * k;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.arc(bx, by, r, t1, t1 + d, d < 0);
  ctx.stroke();
  // the label on the outside of the joint, away from both bones
  const mid = t1 + d / 2 + Math.PI;
  label(
    ctx,
    `${name} ${Math.round(value)}°`,
    bx + Math.cos(mid) * 34 * k,
    by + Math.sin(mid) * 34 * k,
    k,
  );
}

/** A segment drawn long, with its lean from vertical. */
function segmentLine(
  ctx: CanvasRenderingContext2D,
  P: Project,
  f: PoseFrame,
  from: number,
  to: number,
  value: number | null,
  name: string,
  k: number,
) {
  const a = seen(f, from);
  const b = seen(f, to);
  if (!a || !b || value == null) return;
  const [x1, y1] = P(a.x, a.y);
  const [x2, y2] = P(b.x, b.y);
  const ext = 0.35;
  ctx.strokeStyle = "rgba(250,204,21,0.9)";
  ctx.lineWidth = 1.6 * k;
  ctx.setLineDash([6 * k, 5 * k]);
  ctx.beginPath();
  ctx.moveTo(x1 - (x2 - x1) * ext, y1 - (y2 - y1) * ext);
  ctx.lineTo(x2 + (x2 - x1) * ext, y2 + (y2 - y1) * ext);
  ctx.stroke();
  ctx.setLineDash([]);
  label(ctx, `${name} ${Math.round(value)}°`, (x1 + x2) / 2 + 30 * k, (y1 + y2) / 2, k);
}

/** A joint's path through a stretch of the clip (thin, dotted). */
function jointPath(
  ctx: CanvasRenderingContext2D,
  P: Project,
  track: PoseTrack,
  j: number,
  from: number,
  to: number,
  k: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * k;
  ctx.setLineDash([2 * k, 4 * k]);
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < track.t.length; i++) {
    if (track.t[i] < from || track.t[i] > to) continue;
    const p = seen(track.frames[i], j, DRAW_VIS_MIN);
    if (!p) {
      pen = false;
      continue;
    }
    const [x, y] = P(p.x, p.y);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawPose(
  ctx: CanvasRenderingContext2D,
  scene: PoseScene,
  a: LiftAnalysis | null,
  P: Project,
  now: number,
  opts: { selectedRep: number | null; scale?: number },
) {
  const k = opts.scale ?? 1;
  placed = [];
  const { track, layers } = scene;
  const f = frameAt(track, now);
  const rep = a ? (opts.selectedRep ?? repAt(a, now)) : -1;
  const span = a && rep >= 0 ? repSpan(a, rep) : null;

  // the ghost first, under everything
  if (layers.skeleton && scene.compare && a && rep >= 0) {
    let gt: number | null = null;
    if (scene.compare.kind === "start") gt = span?.start ?? null;
    else if (scene.compare.rep !== rep) gt = samePhaseTime(a, rep, scene.compare.rep, now);
    const g = gt != null ? frameAt(track, gt) : null;
    if (g) drawSkeleton(ctx, g, P, scene.side, { k, ghost: true });
  }

  // vertical reference: through the bar where the rep started (else the near foot's middle)
  if (layers.vertical) {
    let x: number | null = null;
    if (a && span) x = valueAt(a.series.t, a.series.x, span.start);
    if (x == null && f && scene.side) {
      const s = sideJoints(scene.side);
      const an = seen(f, s.ankle);
      const toe = seen(f, s.toe);
      if (an && toe) x = (an.x + toe.x) / 2;
    }
    if (x != null) {
      const [px] = P(x, 0);
      const [, top] = P(0, 0);
      const [, bottom] = P(0, 1);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2 * k;
      ctx.setLineDash([8 * k, 6 * k]);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // hip and knee paths through the rep so far
  if (layers.paths && span && scene.side) {
    const s = sideJoints(scene.side);
    const upTo = Math.min(now, span.end);
    jointPath(ctx, P, track, s.hip, span.start, upTo, k, "rgba(125,211,252,0.95)");
    jointPath(ctx, P, track, s.knee, span.start, upTo, k, "rgba(196,181,253,0.95)");
    if (scene.view === "front") {
      jointPath(ctx, P, track, J.lHip, span.start, upTo, k, "rgba(125,211,252,0.95)");
      jointPath(ctx, P, track, J.rHip, span.start, upTo, k, "rgba(125,211,252,0.95)");
    }
  }

  if (!f) return;
  if (layers.skeleton) drawSkeleton(ctx, f, P, scene.side, { k });

  if (scene.angles && scene.side) {
    const s = sideJoints(scene.side);
    const ang = anglesOf(f, scene.side, track.frame);
    if (layers.segments) {
      segmentLine(ctx, P, f, s.hip, s.shoulder, ang.torso, "Torso", k);
      segmentLine(ctx, P, f, s.ankle, s.knee, ang.shin, "Shin", k);
    }
    if (layers.angles) {
      jointAngle(ctx, P, f, s.hip, s.knee, s.ankle, ang.knee, k, "Knee");
      jointAngle(ctx, P, f, s.shoulder, s.hip, s.knee, ang.hip, k, "Hip");
      jointAngle(ctx, P, f, s.shoulder, s.elbow, s.wrist, ang.elbow, k, "Elbow");
    }
  }
}

/* ── a coach's marks ─────────────────────────────────────────────────── */

const MARK = "#facc15";

export function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  P: Project,
  pose: PoseFrame | null,
  k = 1,
  live = false,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of shapes) {
    if (s.kind === "joint") {
      const p = pose ? point(pose, s.j) : null;
      if (!p) continue;
      const [x, y] = P(p.x, p.y);
      for (const [w, c] of [
        [5 * k, "rgba(0,0,0,0.45)"],
        [2.5 * k, MARK],
      ] as const) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 14 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }
    const [x1, y1] = P(s.a[0], s.a[1]);
    const [x2, y2] = P(s.b[0], s.b[1]);
    for (const [w, c] of [
      [5.5 * k, "rgba(0,0,0,0.45)"],
      [3 * k, MARK],
    ] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.setLineDash(live ? [8 * k, 6 * k] : []);
      ctx.beginPath();
      if (s.kind === "circle") {
        ctx.ellipse(
          (x1 + x2) / 2,
          (y1 + y2) / 2,
          Math.abs(x2 - x1) / 2,
          Math.abs(y2 - y1) / 2,
          0,
          0,
          Math.PI * 2,
        );
      } else {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        if (s.kind === "arrow") {
          const th = Math.atan2(y2 - y1, x2 - x1);
          const hl = 14 * k;
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - hl * Math.cos(th - 0.45), y2 - hl * Math.sin(th - 0.45));
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - hl * Math.cos(th + 0.45), y2 - hl * Math.sin(th + 0.45));
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

/** The joint nearest a point on the frame (px tolerance on screen), for the joint tool. */
export function nearestJoint(
  pose: PoseFrame | null,
  fx: number,
  fy: number,
  w: number,
  h: number,
  tolPx: number,
): number | null {
  if (!pose) return null;
  let best: number | null = null;
  let bd = tolPx;
  for (const j of DOTS) {
    const p = point(pose, j);
    if (!p || p.v < DRAW_VIS_MIN) continue;
    const d = Math.hypot((p.x - fx) * w, (p.y - fy) * h);
    if (d <= bd) {
      bd = d;
      best = j;
    }
  }
  return best;
}
