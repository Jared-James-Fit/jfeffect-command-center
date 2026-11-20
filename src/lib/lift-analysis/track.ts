/**
 * Following the plate through every frame (pure). Each frame, the plate is
 * looked for where it should be (where it was, carried on at the speed it was
 * going), at the size it's been all along: the rim's outline scored on a
 * small grid, then measured to a fraction of a pixel (fitRim). A frame where
 * too little of the rim shows (someone walked in front, a hand, motion blur on
 * a fast pull) is marked lost rather than guessed, and the search widens
 * until the plate turns up again, falling back on where the sample frames
 * found it (the anchors).
 */
import { fitRim, rimScore, type RimFit } from "@/lib/lift-analysis/circle";
import { gradients, median, type Frame } from "@/lib/lift-analysis/image";
import type { PlateHit } from "@/lib/lift-analysis/detect";

export type TrackPoint = {
  t: number;
  /** Centre (frame pixels; y down) and size; a / b the rim's horizontal / vertical semi-axes. */
  x: number;
  y: number;
  r: number;
  a: number;
  b: number;
  /** 0…1: the share of the rim that showed (0 when lost). */
  conf: number;
  found: boolean;
};

/** Below this share of the rim showing, the frame doesn't count. */
export const MIN_COVERAGE = 0.33;

export class PlateTracker {
  private pts: TrackPoint[] = [];
  private recentR: number[] = [];
  private recentQ: number[] = [];
  private rTrack: number;
  /** The rim's shape, horizontal ÷ vertical (a plate seen off side-on is an ellipse). */
  private qTrack = 1;
  private lost = 0;
  private strengthRef: number | null = null;
  private readonly anchors: PlateHit[];

  constructor(init: { r: number; anchors: PlateHit[]; q?: number }) {
    this.rTrack = init.r;
    if (init.q && init.q > 0) this.qTrack = Math.min(1.6, Math.max(0.6, init.q));
    this.anchors = [...init.anchors].sort((a, b) => a.t - b.t);
  }

  points(): TrackPoint[] {
    return this.pts;
  }

  /** Where the anchors put the plate at time t (linear between the nearest two), or null with none. */
  private anchorAt(t: number): { x: number; y: number } | null {
    const a = this.anchors;
    if (!a.length) return null;
    if (t <= a[0].t) return a[0];
    if (t >= a[a.length - 1].t) return a[a.length - 1];
    for (let i = 1; i < a.length; i++) {
      if (a[i].t >= t) {
        const f = (t - a[i - 1].t) / (a[i].t - a[i - 1].t || 1);
        return {
          x: a[i - 1].x + f * (a[i].x - a[i - 1].x),
          y: a[i - 1].y + f * (a[i].y - a[i - 1].y),
        };
      }
    }
    return a[a.length - 1];
  }

  /** The last found points (newest last). */
  private lastFound(n: number): TrackPoint[] {
    const out: TrackPoint[] = [];
    for (let i = this.pts.length - 1; i >= 0 && out.length < n; i--)
      if (this.pts[i].found) out.push(this.pts[i]);
    return out.reverse();
  }

  push(frame: Frame): TrackPoint {
    const r = this.rTrack;
    // semi-axes at the tracked size and shape (r is their geometric mean)
    const ax = r * Math.sqrt(this.qTrack);
    const by = r / Math.sqrt(this.qTrack);
    const found = this.lastFound(2);
    let pred: { x: number; y: number };
    let speed = 0;
    let wide = false;
    const last = found[found.length - 1];
    if (last && frame.t - last.t < 0.5) {
      pred = { x: last.x, y: last.y };
      if (found.length === 2 && last.t > found[0].t) {
        const dt = last.t - found[0].t;
        const vx = (last.x - found[0].x) / dt;
        const vy = (last.y - found[0].y) / dt;
        const ahead = frame.t - last.t;
        pred = { x: last.x + 0.9 * vx * ahead, y: last.y + 0.9 * vy * ahead };
        speed = Math.hypot(vx, vy) * ahead;
      }
    } else {
      pred =
        this.anchorAt(frame.t) ??
        (last ? { x: last.x, y: last.y } : { x: frame.w / 2, y: frame.h / 2 });
      wide = true;
    }
    let W = Math.max(4, 0.4 * r) + 0.6 * speed;
    if (this.lost > 0) W = Math.min(1.6 * r, W * (1 + 0.5 * this.lost));
    if (wide) W = Math.max(W, 1.6 * r);
    const pad = W + 1.25 * r + 4;
    const g = gradients(frame, pred.x - pad, pred.y - pad, pred.x + pad, pred.y + pad);
    const step = Math.max(1, Math.round(W / 6));
    type Cand = { x: number; y: number; s: number };
    const cands: Cand[] = [];
    for (let dy = -W; dy <= W + 1e-9; dy += step) {
      for (let dx = -W; dx <= W + 1e-9; dx += step) {
        const x = pred.x + dx;
        const y = pred.y + dy;
        cands.push({ x, y, s: rimScore(g, x, y, ax, 40, by) });
      }
    }
    cands.sort((p, q) => q.s - p.s);
    let best: RimFit | null = null;
    let bestScore = -1;
    const tried: Cand[] = [];
    for (const c of cands) {
      if (tried.length >= 2) break;
      if (tried.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < Math.max(2, 0.25 * r))) continue;
      tried.push(c);
      const fit = fitRim(
        g,
        { x: c.x, y: c.y, r },
        {
          rTol: 0.08,
          band: Math.max(2.5, 0.1 * r),
          edgeMin: this.strengthRef ? Math.max(18, 0.3 * this.strengthRef) : 22,
          ellipse: true,
          axes: { a: ax, b: by },
        },
      );
      if (!fit) continue;
      // nearer what was expected wins a tie
      const near = 1 - Math.min(1, Math.hypot(fit.x - pred.x, fit.y - pred.y) / (W + r));
      const score = fit.coverage * (0.85 + 0.15 * near);
      if (score > bestScore) {
        best = fit;
        bestScore = score;
      }
    }
    const ok =
      !!best &&
      best.coverage >= MIN_COVERAGE &&
      (this.strengthRef == null || best.strength >= 0.3 * this.strengthRef);
    let p: TrackPoint;
    if (ok && best) {
      p = {
        t: frame.t,
        x: best.x,
        y: best.y,
        r: best.r,
        a: best.a,
        b: best.b,
        conf: Math.min(1, best.coverage),
        found: true,
      };
      this.lost = 0;
      this.recentR.push(best.r);
      if (this.recentR.length > 15) this.recentR.shift();
      this.rTrack = median(this.recentR);
      if (best.a > 0 && best.b > 0) {
        this.recentQ.push(best.a / best.b);
        if (this.recentQ.length > 15) this.recentQ.shift();
        this.qTrack = Math.min(1.6, Math.max(0.6, median(this.recentQ)));
      }
      if (this.strengthRef == null && best.coverage > 0.6) this.strengthRef = best.strength;
    } else {
      this.lost++;
      p = { t: frame.t, x: pred.x, y: pred.y, r, a: ax, b: by, conf: 0, found: false };
    }
    this.pts.push(p);
    return p;
  }
}
