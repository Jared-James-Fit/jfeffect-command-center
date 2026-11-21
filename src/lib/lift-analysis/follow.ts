/**
 * Following the plate through every frame (pure), by its own picture.
 *
 * The plate found in the sample frames (find.ts) gives a reference template
 * (template.ts): the plate's disc and rim, cut where it showed best. Each
 * frame, the template is looked for around where the plate should be (where
 * it was, carried on at the speed it was going), first on a half-size frame
 * over a wide window, then at full size around the best spot, to a fraction
 * of a pixel. The point followed is the same physical point every frame: the
 * plate's centre as it was in the reference frame, i.e. the end of the bar.
 *
 * A frame where the match is poor is marked lost, never guessed. After a
 * loss the search widens, and the plate is taken back only with a strong
 * match that sits where the plate's own track (the backbone from the sample
 * frames) says it could be: the tracker can't wander onto a plate on the
 * rack, a head or another bar, and never onto a plate the finder saw sit
 * still the whole clip (a decoy: the spare plate on the tree, identical to
 * the bar's).
 *
 * Every followed frame also measures the rim around the centre (fitRim):
 * its two semi-axes are the plate's size in pixels, what calibration reads.
 */
import { fitRim, type RimFit } from "@/lib/lift-analysis/circle";
import { coreHits, trackAt, halfSize, type CircleTrack } from "@/lib/lift-analysis/find";
import { gradients, type Frame, type Gray } from "@/lib/lift-analysis/image";
import { makeTemplate, search, spunTemplate, type Template } from "@/lib/lift-analysis/template";
import type { TrackPoint } from "@/lib/lift-analysis/track";

/**
 * How good a match (NCC) has to be. Following frame to frame: STRONG on its
 * own, ACCEPT with the plate's rim confirmed there. Finding it again after a
 * loss: SURE on its own, REACQUIRE with the rim.
 */
export const STRONG = 0.6;
export const ACCEPT = 0.4;
export const SURE = 0.75;
export const REACQUIRE = 0.5;

export type FollowSeed = {
  /** The frame the template is cut from, and the plate in it. */
  frame: Gray & { t: number };
  x: number;
  y: number;
  r: number;
  a: number;
  b: number;
  /**
   * More pictures of the same plate, from other well-seen moments far up or
   * down its travel: at the bottom of a bench the plate sits in the bench's
   * shadow and looks different from the top, and each is matched too.
   */
  more?: { frame: Gray & { t: number }; x: number; y: number; r: number }[];
};

/** A circle the bar plate is never taken for (a spare plate that never moved). */
export type Decoy = { x: number; y: number; r: number };

/** Half-width of the window the rim's offset from the picture is smoothed over (s). */
export const RIM_OFFSET_WINDOW_S = 0.25;

/**
 * Each match moved by the median rim offset within ±RIM_OFFSET_WINDOW_S, and
 * never from fewer than the RIM_OFFSET_MIN nearest readings, so one bad rim
 * fit can't move a frame.
 */
export const RIM_OFFSET_MIN = 5;

export function correctRim(
  pts: FollowPoint[],
  off: ({ t: number; dx: number; dy: number } | null)[],
): FollowPoint[] {
  const have = off.filter((o): o is { t: number; dx: number; dy: number } => !!o);
  if (!have.length) return pts;
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[(s.length - 1) >> 1];
  };
  let lo = 0;
  return pts.map((p) => {
    if (!p.found) return p;
    while (lo < have.length && have[lo].t < p.t - RIM_OFFSET_WINDOW_S) lo++;
    let hi = lo;
    while (hi < have.length && have[hi].t <= p.t + RIM_OFFSET_WINDOW_S) hi++;
    // widen to the nearest RIM_OFFSET_MIN readings
    let a = lo;
    let b = hi;
    while (b - a < RIM_OFFSET_MIN && (a > 0 || b < have.length)) {
      const left = a > 0 ? p.t - have[a - 1].t : Infinity;
      const right = b < have.length ? have[b].t - p.t : Infinity;
      if (left <= right) a--;
      else b++;
    }
    const win = have.slice(a, b);
    return { ...p, x: p.x + med(win.map((w) => w.dx)), y: p.y + med(win.map((w) => w.dy)) };
  });
}

/** A rim measured around a match: its centre, size and how much of it showed. */
type RimAt = { x: number; y: number; r: number; a: number; b: number; coverage: number };

/** The rim gives the position when at least this much of it showed. */
export const RIM_POSITION_COVERAGE = 0.5;

export type FollowPoint = TrackPoint & {
  /** The match's NCC (−1…1; −2 when not looked for). */
  score: number;
};

/**
 * Strict following, once the plate's centre and size are known for sure (the
 * athlete confirmed them, or detection was certain): the plate is the same
 * size in every frame of a propped-up clip, and a loaded bar has limits on
 * how fast it can go. Finding it again after losing it then needs its rim
 * there at its own size (±RESIZE_TOLERANCE), never a picture match alone: a
 * picture match alone took the far end's plate (the same plate, half the
 * size, moving at half the bar's travel) on a real bench clip, and a head,
 * and another bar's plate. And no match may sit further from the last place
 * the plate was seen than the bar could have moved since.
 */
export type FollowOptions = {
  strict?: boolean;
  /** mm per px at the analysed size (from the plate's size), for the speed limits. */
  mmPerPx?: number;
};

/** The plate's rim must measure within this share of its known size to take it back after a loss. */
export const RESIZE_TOLERANCE = 0.12;
/** The fastest a loaded bar moves: up or down (a light speed pull or a fast eccentric) and sideways (a walk-out, a re-rack). */
export const MAX_BAR_SPEED_MM_S = { y: 2800, x: 1600 };

export class PlateFollower {
  private readonly ref: Template;
  private readonly refHalf: Template;
  private readonly spun: Template;
  private readonly spunHalf: Template;
  private adapt: Template | null = null;
  private adaptHalf: Template | null = null;
  private readonly r: number;
  private readonly ab: { a: number; b: number };
  private readonly backbone: CircleTrack | null;
  private pts: FollowPoint[] = [];
  private lostRun = 0;
  private since = 0;
  private readonly decoys: Decoy[];
  private readonly views: [Template, Template][] = [];
  private rimOff: ({ t: number; dx: number; dy: number } | null)[] = [];
  private readonly opts: FollowOptions;

  constructor(
    seed: FollowSeed,
    backbone: CircleTrack | null,
    decoys: Decoy[] = [],
    opts: FollowOptions = {},
  ) {
    this.opts = opts;
    const ref = makeTemplate(seed.frame, seed.x, seed.y, seed.r);
    const small = halfSize(seed.frame);
    const refHalf = makeTemplate(small, (seed.x - 0.5) / 2, (seed.y - 0.5) / 2, seed.r / 2);
    if (!ref || !refHalf) throw new Error("plate_off_frame");
    this.ref = ref;
    this.refHalf = refHalf;
    this.spun = spunTemplate(ref);
    this.spunHalf = spunTemplate(refHalf);
    this.r = seed.r;
    this.ab = { a: seed.a, b: seed.b };
    this.backbone = backbone;
    for (const m of seed.more ?? []) {
      // cut at the main picture's size, so every picture points at the same physical centre
      const t = makeTemplate(m.frame, m.x, m.y, seed.r);
      const th = makeTemplate(halfSize(m.frame), (m.x - 0.5) / 2, (m.y - 0.5) / 2, seed.r / 2);
      if (t && th) this.views.push([th, t]);
    }
    // the plate itself is never its own decoy (a bar left in the hooks the whole clip)
    this.decoys = decoys.filter(
      (d) =>
        Math.abs(d.r - seed.r) <= 0.25 * seed.r &&
        Math.hypot(d.x - seed.x, d.y - seed.y) > 0.5 * seed.r,
    );
  }

  /**
   * Every frame's position: the picture's match, moved by where the plate's
   * rim says its centre is. The picture is precise frame to frame but can
   * sit a few pixels off where the plate looks different (the bench's shadow
   * at the bottom of a press, lettering turned with the bar); the rim is
   * geometry and never biased, but noisier. So the offset between them is
   * smoothed over RIM_OFFSET_WINDOW_S and added to every match.
   */
  points(): FollowPoint[] {
    return correctRim(this.pts, this.rimOff);
  }

  /**
   * The frame the plate is known in (a key: confirmed by the athlete, or
   * where detection saw it best): recorded where it is, no search. Every
   * other frame is found from here.
   */
  seedAt(f: Frame, x: number, y: number): FollowPoint {
    const rim = this.rimAt(f, x, y);
    return this.record(f, { x, y, score: 1 }, 1, rim);
  }

  /** The last frames' positions, for the camera-shake read and the prediction. */
  last(): FollowPoint | null {
    return this.pts.length ? this.pts[this.pts.length - 1] : null;
  }

  private lastGood(k = 1): FollowPoint[] {
    const out: FollowPoint[] = [];
    for (let i = this.pts.length - 1; i >= 0 && out.length < k; i--)
      if (this.pts[i].found) out.push(this.pts[i]);
    return out;
  }

  push(f: Frame): FollowPoint {
    const R = this.r;
    const good = this.lastGood(2);
    const bb = this.backbone ? trackAt(this.backbone, f.t) : null;
    // where to look: where the plate was, carried on at the speed it was going; the window is
    // what physics allows (a bar's acceleration stays under ~3 g: R px is 225 mm, so 30 m/s² is ~133 R/s²)
    let px: number;
    let py: number;
    let s: number;
    const tracking = good.length > 0 && this.lostRun === 0;
    if (good.length) {
      const p = good[0];
      let vx = 0;
      let vy = 0;
      if (good.length > 1 && p.t - good[1].t < 0.2) {
        const dt0 = Math.max(1e-3, p.t - good[1].t);
        vx = (p.x - good[1].x) / dt0;
        vy = (p.y - good[1].y) / dt0;
      }
      const dt = Math.max(0, f.t - p.t);
      // strict: after a gap the bar's last speed is carried on only briefly (it slows to a stop at
      // lockout or in the hooks; carried on for half a second it was looked for far past where it was)
      const carry = this.opts.strict ? Math.min(dt, 0.12) : dt;
      px = p.x + vx * carry;
      py = p.y + vy * carry;
      s = Math.max(4, 0.2 * R) + 0.3 * Math.hypot(vx, vy) * dt + 0.5 * 133 * R * dt * dt;
      if (bb && Math.hypot(px - bb.x, py - bb.y) > bb.slack + s) {
        // the plate can't be there: the backbone wins
        px = bb.x;
        py = bb.y;
        s = Math.max(s, Math.min(bb.slack, 3 * R));
      }
    } else if (bb) {
      px = bb.x;
      py = bb.y;
      s = Math.max(0.5 * R, bb.slack);
    } else {
      return this.record(f, null, -2, null);
    }
    s = Math.min(s, 3 * R);
    // half-size search over the window, then full size around the best
    const small = halfSize(f);
    const cx = (px - 0.5) / 2;
    const cy = (py - 0.5) / 2;
    const sHalf = Math.ceil(s / 2);
    const step = sHalf > 10 ? 2 : 1;
    // the plate as it was, spun (a turned plate), and as it was lately (lighting): the best of them
    const kinds: [Template, Template][] = [
      [this.refHalf, this.ref],
      [this.spunHalf, this.spun],
    ];
    for (const v of this.views) kinds.push(v);
    if (this.adaptHalf && this.adapt) kinds.push([this.adaptHalf, this.adapt]);
    let fine = { x: px, y: py, score: -3 };
    for (const [th, tf] of kinds) {
      const m = search(small, th, cx, cy, sHalf, step);
      if (m.score < fine.score - 0.1) continue;
      const fm = search(f, tf, m.x * 2 + 0.5, m.y * 2 + 0.5, 2);
      if (fm.score > fine.score + 0.02) fine = fm;
    }
    // a strong match counts; a weaker one only when the plate's rim is really there, at its size
    const rim = this.rimAt(f, fine.x, fine.y);
    // the plate's own track saw it right here just now: a second, independent sighting
    const bbClose =
      !!bb && bb.slack <= 1.2 * R && Math.hypot(fine.x - bb.x, fine.y - bb.y) <= 0.5 * R;
    // strict: the rim there at the plate's own size (a far plate or a head is a different size)
    const sized = !!rim && Math.abs(rim.r / R - 1) <= RESIZE_TOLERANCE;
    let ok: boolean;
    if (this.opts.strict) {
      ok = tracking
        ? fine.score >= STRONG ||
          (fine.score >= ACCEPT && ((sized && rim!.coverage >= 0.3) || bbClose))
        : fine.score >= REACQUIRE &&
          ((sized && rim!.coverage >= 0.4) || (bbClose && fine.score >= SURE));
      // never further from where it was last seen than the bar could have moved since
      if (ok && good.length) {
        const g0 = good[0];
        const dt = Math.max(0, f.t - g0.t);
        const mm = this.opts.mmPerPx ?? 225 / R;
        const reachX = (MAX_BAR_SPEED_MM_S.x / mm) * dt + 0.25 * R;
        const reachY = (MAX_BAR_SPEED_MM_S.y / mm) * dt + 0.25 * R;
        if (Math.abs(fine.x - g0.x) > reachX || Math.abs(fine.y - g0.y) > reachY) ok = false;
      }
    } else {
      ok = tracking
        ? fine.score >= STRONG ||
          (fine.score >= ACCEPT && ((!!rim && rim.coverage >= 0.3) || bbClose))
        : fine.score >= SURE ||
          (fine.score >= REACQUIRE && ((!!rim && rim.coverage >= 0.4) || bbClose));
    }
    if (ok && bb && Math.hypot(fine.x - bb.x, fine.y - bb.y) > bb.slack + 0.6 * R) ok = false;
    // an identical plate that sat still the whole clip (the tree next to the rack) is never the bar's
    if (ok && this.decoys.some((d) => Math.hypot(fine.x - d.x, fine.y - d.y) < 0.5 * R)) ok = false;
    return this.record(f, ok ? fine : null, fine.score, rim);
  }

  /** The rim around a centre: the plate's measured size there, and how much of it shows (null: no rim of its size). */
  private rimAt(f: Frame, x: number, y: number): RimAt | null {
    const R = this.r;
    const pad = Math.ceil(R * 1.35) + 3;
    const g = gradients(f, x - pad, y - pad, x + pad, y + pad);
    const rim = fitRim(
      g,
      { x, y, r: R },
      { rTol: 0.15, ellipse: true, axes: this.ab, edgeMin: 12 },
    );
    if (!rim || Math.hypot(rim.x - x, rim.y - y) > 0.12 * R) return null;
    return rim;
  }

  private record(
    f: Frame,
    m: { x: number; y: number; score: number } | null,
    score: number,
    rim: RimAt | null,
  ): FollowPoint {
    if (!m) {
      this.lostRun++;
      const p: FollowPoint = {
        t: f.t,
        x: NaN,
        y: NaN,
        r: this.r,
        a: NaN,
        b: NaN,
        conf: 0,
        found: false,
        score,
      };
      this.pts.push(p);
      this.rimOff.push(null);
      return p;
    }
    this.lostRun = 0;
    const R = this.r;
    // the picture's match, and (when the rim showed clearly) how far the rim's own centre sits from
    // it: points() moves every match by that offset, smoothed over time (correctRim)
    const useRim = !!rim && rim.coverage >= RIM_POSITION_COVERAGE;
    this.rimOff.push(useRim ? { t: f.t, dx: rim!.x - m.x, dy: rim!.y - m.y } : null);
    const p: FollowPoint = {
      t: f.t,
      x: m.x,
      y: m.y,
      r: rim ? rim.r : R,
      a: rim ? rim.a : NaN,
      b: rim ? rim.b : NaN,
      conf: rim ? rim.coverage : 0,
      found: true,
      score,
    };
    this.pts.push(p);
    // a fresh copy of the plate now and then (lighting, a turned plate): never instead of the reference
    this.since++;
    if (score >= 0.8 && this.since >= 8) {
      const t = makeTemplate(f, m.x, m.y, R);
      const th = makeTemplate(halfSize(f), (m.x - 0.5) / 2, (m.y - 0.5) / 2, R / 2);
      if (t && th) {
        this.adapt = t;
        this.adaptHalf = th;
        this.since = 0;
      }
    }
    return p;
  }
}

/**
 * The reference frame and the plate's size. A sighting's own circle can be a
 * halo (the rack and the bench behind the plate at lockout can make a bigger
 * circle than the plate), so each sighting's rim is measured from several
 * starting sizes and the fit that runs most of the way round wins; the seed
 * is the sighting whose rim showed most completely, at a size at least one
 * other sighting agrees with.
 */
/** How many of the best-seen sightings are tried as the reference picture. */
export const SEED_CANDIDATES = 6;

export function bestSeed(track: CircleTrack, samples: (Gray & { t: number })[]): FollowSeed | null {
  type Fit = { frame: Gray & { t: number }; fit: RimFit };
  const fits: Fit[] = [];
  for (const h of coreHits(track)) {
    const frame = samples[h.fi];
    if (!frame) continue;
    const pad = Math.ceil(h.r * 1.6) + 3;
    const g = gradients(frame, h.x - pad, h.y - pad, h.x + pad, h.y + pad);
    let best: RimFit | null = null;
    for (const k of [0.72, 0.84, 0.96, 1.08, 1.2]) {
      const fit = fitRim(
        g,
        { x: h.x, y: h.y, r: h.r * k },
        { rTol: 0.12, ellipse: true, edgeMin: 12 },
      );
      if (fit && fit.rms <= 1.5 && (!best || fit.coverage > best.coverage)) best = fit;
    }
    if (best && best.coverage >= 0.45) fits.push({ frame, fit: best });
  }
  fits.sort((a, b) => b.fit.coverage - a.fit.coverage);
  // the candidates: the best-seen sightings at a size another one agrees with
  const cands = fits
    .filter((c) => {
      const R = c.fit.r;
      const agree = fits.filter((o) => o !== c && Math.abs(o.fit.r - R) <= 0.08 * R).length;
      return (agree >= 1 || fits.length <= 1) && !!makeTemplate(c.frame, c.fit.x, c.fit.y, R);
    })
    .slice(0, SEED_CANDIDATES);
  // of those, the picture most like the plate everywhere else it was seen: a moment of motion
  // blur or a hand on the plate can show the whole rim and still be a poor likeness
  if (cands.length > 1) {
    const likeness = new Map<Fit, number>();
    for (const c of cands) {
      const tpl = makeTemplate(c.frame, c.fit.x, c.fit.y, c.fit.r)!;
      const scores = fits
        .filter((o) => o !== c)
        .map((o) => search(o.frame, tpl, o.fit.x, o.fit.y, 2).score)
        .sort((a, b) => a - b);
      likeness.set(c, scores.length ? scores[scores.length >> 1] : 0);
    }
    cands.sort((a, b) => likeness.get(b)! - likeness.get(a)! || b.fit.coverage - a.fit.coverage);
  }
  for (const c of cands) {
    const R = c.fit.r;
    // up to two more pictures: the best-seen sightings of the same size, each at least a radius
    // up or down the travel from every picture already taken
    const more: NonNullable<FollowSeed["more"]> = [];
    const taken = [c.fit.y];
    for (const o of fits) {
      if (more.length >= 2) break;
      if (o === c || Math.abs(o.fit.r - R) > 0.08 * R || o.fit.coverage < 0.6) continue;
      if (taken.some((y) => Math.abs(o.fit.y - y) < R)) continue;
      more.push({ frame: o.frame, x: o.fit.x, y: o.fit.y, r: o.fit.r });
      taken.push(o.fit.y);
    }
    return { frame: c.frame, x: c.fit.x, y: c.fit.y, r: R, a: c.fit.a, b: c.fit.b, more };
  }
  return null;
}
