/**
 * Getting the plate back where the first passes lost it (pure, given the
 * frames of each stretch).
 *
 * The first read follows the plate forward and backward from its keys (the
 * athlete's marker, or where detection was sure). A key is usually at one
 * moment of the clip, so once the forward pass loses the plate mid-set (a
 * hand or a passer-by over it, motion blur at a fast lockout, the plate's
 * look changing against the lifter's legs) nothing comes back for that
 * stretch from the other side: the backward pass only covers the frames
 * before the first key. On real footage that left a 3.6 s hole across a
 * deadlift's lockout with the plate in plain view on both sides of it.
 *
 * So every stretch lost inside the clip with the plate seen on both sides is
 * read again on its own: forward from the last frame before it and backward
 * from the first frame after it, each a fresh follower whose picture of the
 * plate is cut from that very frame (the plate as it looks at that moment,
 * not as it looked at the key on the floor), with every rule the first
 * passes keep (its size, the backbone, the decoys, how fast a loaded bar can
 * move). The two directions are merged the way the first passes are: a frame
 * both reach and agree on, a frame only an unbroken chain reaches, never a
 * frame where they disagree. Nothing is drawn across a gap that wasn't
 * followed; what stays lost is still shown to fix.
 *
 * Only the lost stretches' frames are decoded again, so it costs a fraction
 * of a second on a clip where little was lost and nothing where nothing was.
 */
import type { FollowPoint } from "@/lib/lift-analysis/follow";
import type { Frame } from "@/lib/lift-analysis/image";
import { KeyedPass, mergePasses, type TrackKey } from "@/lib/lift-analysis/keyed";

/** A stretch longer than this (s) isn't gone back for (the plate left the frame, the athlete walked off). */
export const RECOVER_MAX_GAP_S = 8;
/** At most this much of a clip (s) is read again. */
export const RECOVER_MAX_TOTAL_S = 20;
/** Fewer lost frames than this in a row aren't worth a second read (the smoothing bridges them). */
export const RECOVER_MIN_FRAMES = 2;

export type Gap = {
  /** The lost frames' indices (inclusive). */
  i0: number;
  i1: number;
  /** The frames either side where the plate was followed. */
  before: FollowPoint;
  after: FollowPoint;
};

/** The lost stretches with the plate seen on both sides, shortest first, within the budget. */
export function gapsToRecover(points: FollowPoint[]): Gap[] {
  const out: Gap[] = [];
  let i = 0;
  while (i < points.length) {
    if (points[i].found) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < points.length && !points[j + 1].found) j++;
    const before = points[i - 1];
    const after = points[j + 1];
    if (
      before?.found &&
      after?.found &&
      j - i + 1 >= RECOVER_MIN_FRAMES &&
      after.t - before.t <= RECOVER_MAX_GAP_S
    )
      out.push({ i0: i, i1: j, before, after });
    i = j + 1;
  }
  // the budget goes to the most stretches: shortest first
  out.sort((a, b) => a.after.t - a.before.t - (b.after.t - b.before.t));
  const kept: Gap[] = [];
  let total = 0;
  for (const g of out) {
    const len = g.after.t - g.before.t;
    if (total + len > RECOVER_MAX_TOTAL_S) continue;
    total += len;
    kept.push(g);
  }
  return kept.sort((a, b) => a.i0 - b.i0);
}

type Setup = ConstructorParameters<typeof KeyedPass>[2];

/**
 * One stretch read again: `frames` are the frames from the one before it to
 * the one after it, ascending. Returns the stretch's frames (by time) the two
 * directions agree on, or that one unbroken chain reached.
 */
export function recoverGap(
  frames: Frame[],
  gap: Gap,
  shape: { a: number; b: number },
  setup: Setup,
): FollowPoint[] {
  if (frames.length < 3) return [];
  const R = Math.sqrt(shape.a * shape.b);
  const keyOf = (p: FollowPoint): TrackKey => ({
    t: p.t,
    x: p.x,
    y: p.y,
    a: shape.a,
    b: shape.b,
    source: "auto",
  });
  const fwd = new KeyedPass(1, [keyOf(gap.before)], setup);
  for (const f of frames) fwd.push(f);
  const bwd = new KeyedPass(-1, [keyOf(gap.after)], setup);
  for (let i = frames.length - 1; i >= 0; i--) bwd.push(frames[i]);
  const { points } = mergePasses(fwd.points(), bwd.points(), R);
  const t0 = gap.before.t + 1e-4;
  const t1 = gap.after.t - 1e-4;
  return points.filter((p) => p.found && p.t > t0 && p.t < t1);
}

/** The points with each recovered frame put in its place (only where the plate was lost). */
export function applyRecovered(
  points: FollowPoint[],
  recovered: FollowPoint[],
): { points: FollowPoint[]; recovered: number } {
  if (!recovered.length) return { points, recovered: 0 };
  const byT = new Map<number, FollowPoint>();
  for (const p of recovered) byT.set(Math.round(p.t * 1000), p);
  let n = 0;
  const out = points.map((p) => {
    if (p.found) return p;
    const r = byT.get(Math.round(p.t * 1000));
    if (!r) return p;
    n++;
    return { ...r, t: p.t };
  });
  return { points: out, recovered: n };
}

/** Read every recoverable stretch again (frames in memory, ascending). */
export function recoverInMemory(
  frames: Frame[],
  points: FollowPoint[],
  shape: { a: number; b: number },
  setup: Setup,
): { points: FollowPoint[]; recovered: number; gaps: number } {
  const gaps = gapsToRecover(points);
  const got: FollowPoint[] = [];
  for (const g of gaps) {
    const span = frames.filter((f) => f.t >= g.before.t - 1e-4 && f.t <= g.after.t + 1e-4);
    got.push(...recoverGap(span, g, shape, setup));
  }
  const res = applyRecovered(points, got);
  return { ...res, gaps: gaps.length };
}
