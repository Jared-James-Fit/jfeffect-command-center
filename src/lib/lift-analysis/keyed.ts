/**
 * Following the plate from the frames it's known in, both ways (pure).
 *
 * A key is a frame where the plate's centre and size are known for sure: the
 * athlete confirmed the marker there (or detection was certain), or put the
 * marker right on a frame the tracking got wrong (a correction). The clip is
 * followed forward from every key to the next and backward from every key to
 * the one before, so every frame between two keys is reached from both
 * sides, and every frame is reached from at least one key: the first frames
 * of the clip are followed backward from the first key instead of being
 * guessed at before the plate was ever seen.
 *
 * Each followed point says whether it's in an unbroken chain from its key
 * (no frame lost since). Where the two directions disagree the chained one
 * wins; where both are chained and still disagree, or neither is, the frame
 * is lost: a wrong position is never chosen between, it's left out (and the
 * stretch is shown to the athlete as one to fix).
 */
import type { CircleTrack } from "@/lib/lift-analysis/find";
import {
  PlateFollower,
  type Decoy,
  type FollowOptions,
  type FollowPoint,
  type FollowSeed,
} from "@/lib/lift-analysis/follow";
import type { Frame, Gray } from "@/lib/lift-analysis/image";

export type KeySource = "auto" | "confirmed" | "correction";

export type TrackKey = {
  /** The frame's time (s, the file's clock) and the plate's centre and semi-axes there (analysed px). */
  t: number;
  x: number;
  y: number;
  a: number;
  b: number;
  source: KeySource;
};

export type KeyedPoint = FollowPoint & {
  /** No frame lost between this one and its key. */
  chain: boolean;
  /** Which key it was followed from (index into the sorted keys). */
  key: number;
};

/** Within this much of a key's time (s) a frame is the key's frame. */
export const KEY_TIME_TOLERANCE = 0.02;

/** The same track with time running backward (for the backward pass). */
function reverseTrack(t: CircleTrack): CircleTrack {
  return {
    ...t,
    hits: [...t.hits].reverse().map((h) => ({ ...h, t: -h.t })),
  };
}

type Setup = {
  backbone: CircleTrack | null;
  decoys: Decoy[];
  follow: FollowOptions;
  /** Every key's picture of the plate (each pass matches against all of them). */
  views?: FollowSeed["more"];
};

/**
 * One direction. Frames are pushed in that direction's order (dir = 1:
 * ascending time; −1: descending). Each key starts a fresh follower at its
 * frame; the follower runs on "pass time" (dir × t), so the same physics
 * (speed carried on, windows that grow with time) works both ways.
 */
export class KeyedPass {
  private readonly keys: TrackKey[];
  private next = 0;
  private fol: PlateFollower | null = null;
  private keyIdx = -1;
  private lostSinceKey = false;
  private readonly out: KeyedPoint[] = [];
  private readonly segs: { fol: PlateFollower; from: number }[] = [];
  private readonly backbone: CircleTrack | null;

  constructor(
    readonly dir: 1 | -1,
    keys: TrackKey[],
    private readonly setup: Setup,
  ) {
    this.keys = [...keys].sort((a, b) => dir * (a.t - b.t));
    this.backbone = setup.backbone
      ? dir === 1
        ? setup.backbone
        : reverseTrack(setup.backbone)
      : null;
  }

  /** The original key index (ascending time) of a key in this pass's order. */
  private orig(i: number): number {
    return this.dir === 1 ? i : this.keys.length - 1 - i;
  }

  push(f: Frame): KeyedPoint | null {
    const d = this.dir;
    // a key reached: a fresh follower from it
    while (
      this.next < this.keys.length &&
      d * (f.t - this.keys[this.next].t) >= -KEY_TIME_TOLERANCE
    ) {
      const k = this.keys[this.next];
      // only on the key's own frame (a frame further on than the tolerance still starts it: the frame nearest it)
      const frame = { ...f, t: d * f.t } as Frame;
      try {
        this.fol = new PlateFollower(
          {
            frame: frame as Gray & { t: number },
            x: k.x,
            y: k.y,
            r: Math.sqrt(k.a * k.b),
            a: k.a,
            b: k.b,
            more: (this.setup.views ?? [])
              .filter((v) => Math.abs(v.frame.t - k.t) > KEY_TIME_TOLERANCE)
              .map((v) => ({ ...v, frame: { ...v.frame, t: d * v.frame.t } })),
          },
          this.backbone,
          this.setup.decoys,
          this.setup.follow,
        );
      } catch {
        this.fol = null;
      }
      this.keyIdx = this.orig(this.next);
      this.lostSinceKey = false;
      this.next++;
      if (this.fol) {
        this.segs.push({ fol: this.fol, from: this.out.length });
        const p = this.fol.seedAt(frame, k.x, k.y);
        return this.emit(f, p);
      }
    }
    if (!this.fol) return null;
    const p = this.fol.push({ ...f, t: d * f.t });
    return this.emit(f, p);
  }

  private emit(f: Frame, p: FollowPoint): KeyedPoint {
    if (!p.found) this.lostSinceKey = true;
    const q: KeyedPoint = { ...p, t: f.t, chain: p.found && !this.lostSinceKey, key: this.keyIdx };
    this.out.push(q);
    return q;
  }

  /**
   * Every point, ascending time, with each follower's rim correction applied
   * (correctRim, over that follower's own frames).
   */
  points(): KeyedPoint[] {
    const out = this.out.map((p) => ({ ...p }));
    for (const seg of this.segs) {
      const cp = seg.fol.points();
      for (let j = 0; j < cp.length && seg.from + j < out.length; j++) {
        const o = out[seg.from + j];
        if (o.found && cp[j].found) {
          o.x = cp[j].x;
          o.y = cp[j].y;
        }
      }
    }
    return this.dir === 1 ? out : out.reverse();
  }
}

/** How far apart (share of the radius) two directions' positions can be and still be the same plate. */
export const AGREE_SHARE = 0.3;

/**
 * One position per frame from the forward and backward passes. Frames are
 * matched by time.
 */
export function mergePasses(
  fwd: KeyedPoint[],
  bwd: KeyedPoint[],
  r: number,
): { points: FollowPoint[]; conflicts: number } {
  const byT = new Map<number, { f?: KeyedPoint; b?: KeyedPoint }>();
  const key = (t: number) => Math.round(t * 1000);
  for (const p of fwd) byT.set(key(p.t), { ...(byT.get(key(p.t)) ?? {}), f: p });
  for (const p of bwd) byT.set(key(p.t), { ...(byT.get(key(p.t)) ?? {}), b: p });
  const times = [...byT.keys()].sort((a, b) => a - b);
  let conflicts = 0;
  const lost = (p: KeyedPoint): FollowPoint => ({
    ...p,
    x: NaN,
    y: NaN,
    a: NaN,
    b: NaN,
    conf: 0,
    found: false,
  });
  const points = times.map((k) => {
    const { f, b } = byT.get(k)!;
    const F = f?.found ? f : null;
    const B = b?.found ? b : null;
    if (F && B) {
      const dist = Math.hypot(F.x - B.x, F.y - B.y);
      if (dist <= AGREE_SHARE * r) {
        // the same plate: the mean (each is precise; their difference is the tracking's own noise)
        const both = (u: number, v: number) =>
          Number.isFinite(u) && Number.isFinite(v) ? (u + v) / 2 : Number.isFinite(u) ? u : v;
        return {
          ...F,
          x: (F.x + B.x) / 2,
          y: (F.y + B.y) / 2,
          a: both(F.a, B.a),
          b: both(F.b, B.b),
          r: both(F.r, B.r),
          conf: Math.max(F.conf, B.conf),
          score: Math.max(F.score, B.score),
          found: true,
        } as FollowPoint;
      }
      if (F.chain && !B.chain) return F as FollowPoint;
      if (B.chain && !F.chain) return B as FollowPoint;
      conflicts++;
      return lost(F);
    }
    if (F) return F as FollowPoint;
    if (B) return B as FollowPoint;
    return lost((f ?? b)!);
  });
  return { points, conflicts };
}

/** Stretches (s) where the plate wasn't followed, at least `minFrames` long, inside [from, to]. */
export function lostStretches(
  pts: { t: number; found: boolean }[],
  from: number,
  to: number,
  minFrames = 3,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let s = -1;
  for (let i = 0; i <= pts.length; i++) {
    const lost = i < pts.length && !pts[i].found && pts[i].t >= from && pts[i].t <= to;
    if (lost && s < 0) s = i;
    if (!lost && s >= 0) {
      if (i - s >= minFrames) out.push({ start: pts[s].t, end: pts[i - 1].t });
      s = -1;
    }
  }
  return out;
}
