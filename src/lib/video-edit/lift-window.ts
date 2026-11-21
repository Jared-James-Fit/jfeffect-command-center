/**
 * Where the lift is in a clip (pure, tested): the part worth keeping when a
 * set is filmed with the walk to the bar, the wait and the walk back to the
 * phone around it. It reads tiny greyscale frames, about one a second
 * (lift.ts decodes them on the phone), and never guesses what it can't see:
 * a clip that's all lifting, shot handheld, or with nothing clear going on
 * gets no suggestion, with why (readLift).
 *
 *   1. what moved between each pair of frames (a mask: brighter or darker by
 *      more than the picture's own shift, read for its dark and its bright
 *      half apart, so the phone re-exposing doesn't count)
 *   2. the walks, from the picture itself: the clip opening or closing on a
 *      picture that isn't its usual one (someone at the lens), run on while a
 *      lot keeps moving. Only at the clip's ends: someone crossing mid-set is
 *      no walk to the phone.
 *   3. the lifter's own pixels: movement that keeps coming back (moments with
 *      a quarter of the picture moving don't vote) and moves together with
 *      where the walk ended, so a person waiting beside the bar or lifting at
 *      the next station isn't part of it
 *   4. each moment: lifting (moving in the lifter's own pixels), still, off
 *      the bar (the walks; a lot moving away with nothing at the bar) or the
 *      phone itself (half the picture moving). A lot moving away while they
 *      lift (the platform shaking as the bar lands, someone crossing close)
 *      stays lifting, but is never what the set is measured by.
 *   5. the set: the bout with the most lifting in it, joined to the bouts
 *      either side that are as strong (a breath between heavy reps, a walkout
 *      and then the squats), never across a walk; held to a few seconds
 *      before its first hard movement and after its last, so a wait at the
 *      bar isn't kept; a moment kept either side.
 *
 * Tuned on simulated sets (src/test/helpers/lift-scenes.ts: lifts, cameras,
 * bystanders, shake, frame rates): the worst outcome is a cut into the reps,
 * so every doubt is settled toward keeping more.
 */

export type LiftFrame = { t: number; px: Uint8Array };
export type LiftWindow = { start: number; end: number };
export type MomentKind = "still" | "lift" | "off" | "phone";

/** Kept either side of the lift (the unrack before it, the rack after it). */
export const LIFT_PAD_BEFORE = 0.5;
export const LIFT_PAD_AFTER = 0.8;
/** A pause this long or shorter never splits the lifting into two bouts. */
export const LIFT_GAP_MAX = 3;
/** Movement well away from the bar this long or shorter stays in a bout (someone walking past the lens). */
export const LIFT_STRAY_MAX = 2.5;
/** Two bouts as strong as each other with a pause up to this long between them are one set (a breath between heavy reps). */
export const LIFT_PAUSE_MAX = 10;
/** Between two such bouts, movement off the bar up to this long is someone crossing, never the walk to the phone and back. */
export const LIFT_CROSS_MAX = 4.5;
/** Kept before the first hard movement and after the last, at most (the wait at the bar is cut). */
export const LIFT_LEAD_MAX = 3.5;
export const LIFT_TAIL_MAX = 3.5;
/** A lift is at least this long. */
export const LIFT_MIN = 2.5;

/** Frames closer than this are thinned before they're read. */
export const FRAME_GAP = 0.8;
/**
 * Frames further apart than this over a quarter of the clip: no suggestion.
 * On the simulated sets it cuts into the lifting 2% of the time at a frame a
 * second, 5% at one every 2 s, 12% at 2.5 s and 20% at 3.3 s.
 */
export const FRAME_GAP_MAX = 2.2;
/** Grey levels a pixel must change by, over the frame's own typical change, to count as moving. */
const DIFF_T = 24;
/** Share of the picture moving for "something's happening". */
const ACTIVE_MIN = 0.012;
/** More than this moving: the phone itself, or someone right in front of it. */
const PHONE_MOVED = 0.5;
/** A moment with more than this moving doesn't vote for where the bar is (someone near the lens). */
const ZONE_SKIP = 0.22;
/** This much of the picture moving well away from the bar: walking to or from the phone, or someone close crossing. */
const BIG_FAR = 0.06;
/** Under this much of the picture away from its usual self, it's never someone between the lens and the bar. */
const WALK_MIN = 0.12;
/** The picture's usual distance from itself at this share or more: held in a hand. */
const HANDHELD = 0.3;
/** A moment next to a walk with less than this moving around the lifter and away from them: a rep, not a step. */
const STEP_RING = 0.03;
const STEP_FAR = 0.005;
/** This share of the moments between the walks with a lot moving away from the bar: held in a hand. */
const HANDHELD_MOMENTS = 0.4;
/** Someone at the lens is looked for in this many seconds from each end of the clip. */
const WALK_LOOK = 7;
/** Moments longer than this (frames read far apart) are read with more care: nothing is halved or given to the walk on a guess. */
const SPARSE = 1.3;
/** A place moves again and again: at this share of the busiest one's count, and at least about once (with its neighbours). */
const REPEAT_SHARE = 0.3;
const REPEAT_MIN = 0.9;
/** Moved this many times (with its neighbours): part of what usually moves, never "off the bar". */
const USUAL_MIN = 2.5;
/** A first guess at the lifter needs this many pixels. */
const SEED_MIN = 4;
/** The guess is moving in a moment when this share of it moved. */
const SEED_MOVING = 0.08;
/** A pixel is the lifter's when it moves with the guess this much more than chance (phi). */
const MOVES_WITH = 0.3;
/** The band around the lifter's own pixels is this many pixels deep. */
const RING_PX = 3;
/** Pieces this many pixels apart are one lifter. */
const JOIN_PX = 2;
/** Share of the bar's spot moving for "lifting". */
const LIFT_IN = 0.02;
/** A bout either side joins the set when its hardest moment is at least this share of the set's usual one. */
const JOIN_STRENGTH = 0.45;
/** A stretch of two moments is the set's own when it's this share of the hardest stretch's. */
const HARD = 0.8;
/** Lifting moments this far apart or less are one stretch. */
const HARD_GAP = 1.3;
/** A stretch this long is lasting; one this long at least can be a rep on its own. */
const HARD_LASTS = 2.4;
const HARD_BRIEF = 1.4;
/** A moment at least this share of the set's usual one is a hard movement (a rep, an unrack). */
const STRONG = 0.45;

export type Moment = {
  t0: number;
  t1: number;
  kind: MomentKind;
  /** Share of the bar's spot moving. */
  inside: number;
  /** Share of the band around it moving. */
  ring: number;
  /** Share of the whole picture moving well away from the bar. */
  far: number;
  /** Share of the whole picture moving. */
  area: number;
  /**
   * Lifting that isn't the set's own measure: right next to the walk from the
   * phone or back to it (its last step in, its first step out), or with a lot
   * else moving in the picture (someone crossing close, the phone shaken).
   */
  spill: boolean;
  /** The walk's last step in or first step out: counts from its middle. */
  step?: boolean;
};

/** The median of b − a over the pixels picked (signed), from a histogram. */
function medianOf(hist: Uint32Array, total: number): number {
  let seen = 0;
  const half = total / 2;
  for (let v = 0; v < 511; v++) {
    seen += hist[v];
    if (seen >= half) return v - 255;
  }
  return 0;
}

/**
 * The picture's own shift between two frames, for its darker and its brighter
 * half apart: the phone re-exposing moves every pixel the same way, the
 * bright ones further (taken out); the phone itself moving or someone walking
 * moves them both ways (left in).
 */
function frameShift(a: Uint8Array, b: Uint8Array): { split: number; dark: number; bright: number } {
  const levels = new Uint32Array(256);
  for (let i = 0; i < a.length; i++) levels[a[i]]++;
  let seen = 0;
  let split = 0;
  for (let v = 0; v < 256; v++) {
    seen += levels[v];
    if (seen >= a.length / 2) {
      split = v;
      break;
    }
  }
  const dark = new Uint32Array(511);
  const bright = new Uint32Array(511);
  let nd = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] <= split) {
      dark[b[i] - a[i] + 255]++;
      nd++;
    } else {
      bright[b[i] - a[i] + 255]++;
      nb++;
    }
  }
  const d = nd ? medianOf(dark, nd) : 0;
  return { split, dark: d, bright: nb > a.length / 8 ? medianOf(bright, nb) : d };
}

export type Mask = { t0: number; t1: number; mask: Uint8Array; count: number };

/** What moved between each pair of frames. */
export function motionMasks(frames: LiftFrame[]): Mask[] {
  const out: Mask[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].px;
    const b = frames[i].px;
    if (a.length !== b.length || !a.length) continue;
    const s = frameShift(a, b);
    const mask = new Uint8Array(a.length);
    let count = 0;
    for (let p = 0; p < a.length; p++) {
      if (Math.abs(b[p] - a[p] - (a[p] <= s.split ? s.dark : s.bright)) > DIFF_T) {
        mask[p] = 1;
        count++;
      }
    }
    out.push({ t0: frames[i - 1].t, t1: frames[i].t, mask, count });
  }
  return out;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };
const boxArea = (b: Box) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);

/** A 3×3 blur, so a patch holds together. */
function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += src[yy * w + xx];
          c++;
        }
      }
      out[y * w + x] = s / c;
    }
  }
  return out;
}

/** The patches (4-connected) of a map at or over a level, as boxes. */
function patches(map: Float32Array, w: number, h: number, level: number): Box[] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out: Box[] = [];
  const stack: number[] = [];
  for (let p = 0; p < n; p++) {
    if (seen[p] || !(map[p] >= level)) continue;
    let box: Box = { x0: w, y0: h, x1: -1, y1: -1 };
    stack.push(p);
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w;
      const y = (q - x) / w;
      box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
      const next = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
      for (const r of next)
        if (r >= 0 && !seen[r] && map[r] >= level) {
          seen[r] = 1;
          stack.push(r);
        }
    }
    out.push(box);
  }
  return out;
}

/**
 * Where the lifting happens: the place that keeps moving. Every moment that
 * isn't someone at the lens, or the walk ending or beginning, marks what
 * moved in it; what moved again and again is the lift (a person crossing
 * marks a place once or twice). Pieces a few pixels apart are one lifter
 * (dark clothes on a dark wall show as a head, arms and plates); of the
 * places that qualify, the one they walked to from the phone wins, else the
 * one with the most movement in it, the middle of the picture counting for
 * more: the person filmed, not someone shifting at its edge.
 */
export function liftZone(masks: { mask: Uint8Array; count: number }[], w: number, h: number, walked: Walks | null = null): Box | null {
  return liftSpot(masks, w, h, walked)?.zone ?? null;
}

/**
 * The bar's spot, with everywhere movement keeps coming back to (the lift's
 * own reach past its spot, and anyone else who keeps moving in one place, at
 * their own station or waiting at the edge), a pixel wider: movement there is
 * never "off the bar".
 */
export function liftSpot(masks: { mask: Uint8Array; count: number }[], w: number, h: number, walked: Walks | null = null): LiftSpot | null {
  const n = w * h;
  // the moments that say where things keep moving: not someone at the lens, not the walk ending or beginning
  const votes: number[] = [];
  const times = new Float32Array(n);
  masks.forEach((m, i) => {
    const share = m.count / n;
    if (share < ACTIVE_MIN || share > ZONE_SKIP || walked?.moments.has(i) || (walked && (i <= walked.arrive || (walked.leave >= 0 && i >= walked.leave)))) return;
    for (let p = 0; p < n; p++) if (m.mask[p]) times[p] += 1;
    votes.push(i);
  });
  if (!votes.length) return null;
  const soft = blur3(times, w, h);
  let max = 0;
  for (let p = 0; p < n; p++) if (soft[p] > max) max = soft[p];
  if (!(max > 0)) return null;
  const level = Math.max(REPEAT_MIN, max * REPEAT_SHARE);
  const hot = new Uint8Array(n);
  let hotCount = 0;
  for (let p = 0; p < n; p++)
    if (soft[p] >= level) {
      hot[p] = 1;
      hotCount++;
    }
  if (!hotCount) return null;

  /* ---- a first guess at the lifter: where they walked to, else the busiest place ---- */
  let seed: number[] = [];
  if (walked) {
    // what moved as the walk ended and as it began: where they stand at the bar is in both
    const both: number[] = [];
    const either: number[] = [];
    for (let p = 0; p < n; p++) {
      if (!hot[p]) continue;
      if (walked.in[p] && walked.out[p]) both.push(p);
      if (walked.in[p] || walked.out[p]) either.push(p);
    }
    seed = both.length >= SEED_MIN ? both : either.length >= SEED_MIN ? either : [];
  }
  if (!seed.length) {
    // pieces within a few pixels of each other are one place; the one with the most movement in it, the middle counting for more
    const joined = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!hot[y * w + x]) continue;
        for (let dy = -JOIN_PX; dy <= JOIN_PX; dy++)
          for (let dx = -JOIN_PX; dx <= JOIN_PX; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w) joined[yy * w + xx] = 1;
          }
      }
    let bestScore = -1;
    for (const wide of patches(joined, w, h, 1)) {
      const px: number[] = [];
      let mass = 0;
      let sx = 0;
      for (let y = wide.y0; y <= wide.y1; y++)
        for (let x = wide.x0; x <= wide.x1; x++) {
          const p = y * w + x;
          if (!hot[p]) continue;
          px.push(p);
          mass += times[p];
          sx += x + 0.5;
        }
      if (!px.length) continue;
      const off = Math.abs(sx / px.length - w / 2) / (w / 2);
      const score = mass * (1 - 0.55 * Math.min(1, off));
      if (score > bestScore) {
        bestScore = score;
        // its busiest pixels: the part that surely is one mover
        const top = px.map((p) => times[p]).sort((a, b) => b - a)[Math.min(px.length - 1, Math.floor(px.length / 3))];
        seed = px.filter((p) => times[p] >= top);
      }
    }
  }
  if (!seed.length) return null;

  /* ---- the lifter: what moves when the guess moves (someone else beside them moves at other times) ---- */
  const N = votes.length;
  const on = new Uint8Array(N);
  let onCount = 0;
  votes.forEach((mi, k) => {
    let c = 0;
    const m = masks[mi].mask;
    for (const p of seed) c += m[p];
    if (c >= Math.max(2, seed.length * SEED_MOVING)) {
      on[k] = 1;
      onCount++;
    }
  });
  let box: Box = { x0: w, y0: h, x1: -1, y1: -1 };
  let kept = 0;
  const mine = new Uint8Array(n);
  if (onCount && onCount < N) {
    for (let p = 0; p < n; p++) {
      if (!hot[p]) continue;
      // how often this pixel moves with the guess, against how often it would by chance
      let n11 = 0;
      let n10 = 0;
      votes.forEach((mi, k) => {
        if (!masks[mi].mask[p]) return;
        if (on[k]) n11++;
        else n10++;
      });
      const n01 = onCount - n11;
      const n00 = N - onCount - n10;
      const den = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
      const phi = den > 0 ? (n11 * n00 - n10 * n01) / den : 0;
      if (phi < MOVES_WITH) continue;
      mine[p] = 1;
      kept++;
    }
  }
  if (kept < SEED_MIN) {
    // it moves the whole time (a clip that's all lifting), or too little to tell: the guess itself
    mine.fill(0);
    for (const p of seed) mine[p] = 1;
  }
  // the lifter's own pixels, one wider (an edge moves a pixel either way)
  const own = new Uint8Array(n);
  let ownCount = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && mine[yy * w + xx]) hit = 1;
        }
      if (!hit) continue;
      own[y * w + x] = 1;
      ownCount++;
      box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
    }
  const usual = new Uint8Array(n);
  // what truly keeps moving: more than a person crossing leaves behind
  const usualLevel = Math.max(USUAL_MIN, level);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!(soft[y * w + x] >= usualLevel)) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) usual[yy * w + xx] = 1;
        }
    }
  return { zone: box, own, size: ownCount, usual, walkIn: walked?.arrive ?? -1, walkOut: walked?.leave ?? -1, softIn: walked?.softIn ?? -1, softOut: walked?.softOut ?? -1 };
}

export type LiftSpot = {
  /** The box around the lifter's pixels. */
  zone: Box;
  /** The lifter's own pixels (what moves when they lift), and how many. */
  own: Uint8Array;
  size: number;
  /** Everywhere movement keeps coming back to (see liftSpot). */
  usual: Uint8Array;
  /** The moment the walk from the phone ends in, and the one the walk back starts in (−1: none seen). */
  walkIn: number;
  walkOut: number;
  softIn: number;
  softOut: number;
};

/**
 * Where the walk from the phone ended and the walk back began: what moved in
 * the moment right after someone was at the lens at the clip's start, and in
 * the one right before someone was at it at the end (with which moments
 * those were). Null when nobody was at the lens at either end (filmed by
 * someone else, or already cut).
 */
/**
 * The picture as it usually is: each pixel's middle value over frames from
 * the middle half of the clip (the gym, with the lifter at the bar when
 * that's where they mostly are).
 */
function usualPicture(frames: LiftFrame[]): Uint8Array {
  const from = Math.floor(frames.length * 0.25);
  const to = Math.max(from + 1, Math.ceil(frames.length * 0.75));
  const pick: Uint8Array[] = [];
  const step = Math.max(1, Math.floor((to - from) / 15));
  for (let i = from; i < to && pick.length < 15; i += step) pick.push(frames[i].px);
  const n = pick[0].length;
  const out = new Uint8Array(n);
  const vals = new Uint8Array(pick.length);
  for (let p = 0; p < n; p++) {
    for (let k = 0; k < pick.length; k++) vals[k] = pick[k][p];
    vals.sort();
    out[p] = vals[pick.length >> 1];
  }
  return out;
}

/** How much of each frame isn't the usual picture (someone between the lens and the bar covers a lot of it; a rep, a little). */
export function awayFromUsual(frames: LiftFrame[]): number[] {
  if (!frames.length) return [];
  const usual = usualPicture(frames);
  return frames.map((f) => {
    if (f.px.length !== usual.length) return 0;
    const s = frameShift(usual, f.px);
    let c = 0;
    for (let p = 0; p < usual.length; p++) if (Math.abs(f.px[p] - usual[p] - (usual[p] <= s.split ? s.dark : s.bright)) > DIFF_T) c++;
    return c / usual.length;
  });
}

export type Walks = {
  /** What moved as the walk from the phone ended, and as the walk back began. */
  in: Uint8Array;
  out: Uint8Array;
  /** The moments those were. */
  moments: Set<number>;
  /** The last moment of the walk in, and the first of the walk out (−1: none). */
  arrive: number;
  leave: number;
  /** The smaller moment next to each walk that was taken as its last step in / first step out (−1: none). */
  softIn: number;
  softOut: number;
};

/**
 * The walk from the phone and the walk back to it, read from the picture
 * itself: the clip opens (or closes) on frames that aren't the usual picture,
 * someone standing at the lens or on their way, whether or not they're
 * moving. Someone crossing in the middle of the clip is no walk, and a clip
 * someone else filmed has none. Null when there's neither, or the picture is
 * never the same twice (held in a hand).
 */
export function findWalks(frames: LiftFrame[], masks: Mask[]): Walks | null | "handheld" {
  const away = awayFromUsual(frames);
  if (away.length < 4 || masks.length !== frames.length - 1) return null;
  const mid = away.slice(Math.floor(away.length * 0.25), Math.max(Math.floor(away.length * 0.25) + 1, Math.ceil(away.length * 0.75))).sort((a, b) => a - b);
  const usual = mid[mid.length >> 1];
  // most of the picture differs from itself most of the time: the phone is moving
  if (usual >= HANDHELD) return "handheld";
  const near = Math.max(WALK_MIN, usual * 2);
  const F = frames.length;
  let lead = 0;
  while (lead < F && away[lead] >= near) lead++;
  let tail = F - 1;
  while (tail > lead && away[tail] >= near) tail--;
  // frames [0, lead) aren't the usual picture: someone's at the lens as the clip opens; frames (tail, F): as it closes.
  // From there the walk runs on while a lot of the picture keeps moving, and ends in the first moment that's smaller.
  const n = frames[0].px.length;
  const share = (i: number) => masks[i].count / n;
  const active = masks.map((m) => m.count / n).filter((a) => a >= ACTIVE_MIN).sort((a, b) => a - b);
  const moving = Math.min(ZONE_SKIP, Math.max(WALK_MIN, (active.length ? active[active.length >> 1] : 0) * 2.5));
  const mIn = new Uint8Array(n);
  const mOut = new Uint8Array(n);
  const moments = new Set<number>();
  let arrive = -1;
  let leave = -1;
  let softIn = -1;
  let softOut = -1;
  const brief = (i: number) => masks[i].t1 - masks[i].t0 <= SPARSE;
  const take = (i: number, into: Uint8Array) => {
    const m = masks[i].mask;
    for (let p = 0; p < n; p++) if (m[p]) into[p] = 1;
    moments.add(i);
  };
  if (lead > 0 && lead < F) {
    // moments 0 … lead − 2 lie between two frames with someone at the lens
    let j = Math.max(0, lead - 2);
    while (j + 1 < masks.length && share(j + 1) >= moving) j++;
    arrive = j;
    if (j + 1 < masks.length && share(j + 1) >= ACTIVE_MIN && j + 1 <= lead + 1) {
      take(j + 1, mIn);
      if (brief(j + 1)) {
        arrive = j + 1;
        softIn = j + 1;
      }
    } else take(j, mIn);
  }
  if (tail < F - 1 && tail >= lead) {
    // moments tail + 1 … lie between two frames with someone at the lens
    let j = Math.min(masks.length - 1, tail + 1);
    while (j - 1 > arrive && share(j - 1) >= moving) j--;
    leave = j;
    if (j - 1 > arrive && share(j - 1) >= ACTIVE_MIN && j - 1 >= tail - 2) {
      take(j - 1, mOut);
      if (brief(j - 1)) {
        leave = j - 1;
        softOut = j - 1;
      }
    } else take(j, mOut);
  }
  if (!moments.size) return null;
  // seen at one end only: that end stands for both
  if (arrive < 0) mIn.set(mOut);
  if (leave < 0) mOut.set(mIn);
  return { in: mIn, out: mOut, moments, arrive, leave, softIn, softOut };
}

/** Each moment between two frames: still, the lift, off the bar, or the phone itself. */
export function classifyMoments(masks: Mask[], w: number, h: number, spot: LiftSpot): Moment[] {
  const n = w * h;
  const { own, usual } = spot;
  const zoneArea = Math.max(1, spot.size);
  // around the lifter: a few pixels past their own
  const band = new Uint8Array(n);
  let ringArea = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (own[y * w + x]) continue;
      let hit = 0;
      for (let dy = -RING_PX; dy <= RING_PX && !hit; dy++)
        for (let dx = -RING_PX; dx <= RING_PX && !hit; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && own[yy * w + xx]) hit = 1;
        }
      if (hit) {
        band[y * w + x] = 1;
        ringArea++;
      }
    }
  // the lift fills most of the picture (filmed up close): moving anywhere short of the whole picture is the lift
  const closeUp = zoneArea / n > 0.6;
  const walkIn = spot.walkIn;
  const walkOut = spot.walkOut >= 0 ? spot.walkOut : Infinity;
  const moments = masks.map((m, i): Moment => {
    let inZone = 0;
    let inRing = 0;
    let away = 0;
    for (let p = 0; p < n; p++) {
      if (!m.mask[p]) continue;
      if (own[p]) inZone++;
      else if (band[p]) inRing++;
      else if (!usual[p]) away++;
    }
    const area = m.count / n;
    const inside = inZone / zoneArea;
    const ring = ringArea > 0 ? inRing / ringArea : 0;
    const far = away / n;
    const lifting = inside >= LIFT_IN && inZone >= 4;
    const big = !closeUp && far > BIG_FAR;
    let kind: MomentKind;
    if (area > PHONE_MOVED) kind = "phone";
    // the walk from the phone and the walk back to it, whatever else it looks like
    // (the smaller moment next to a walk that moved only where the lifter lifts is a rep, not a step)
    else if (i <= walkIn || i >= walkOut) kind = (i === spot.softIn || i === spot.softOut) && lifting && ring < STEP_RING && far < STEP_FAR ? "lift" : "off";
    // a lot moving away from the bar with nothing at it: someone crossing close
    else if (big && !lifting) kind = "off";
    else if (lifting) kind = "lift";
    else kind = "still";
    // lifting with a lot else moving (someone crossing close, the platform shaking the phone as the bar lands): it's kept, never what the set is measured by
    return { t0: m.t0, t1: m.t1, kind, inside, ring, far, area, spill: kind === "lift" && big };
  });
  // the walk in and the walk out: the runs of off-the-bar moments at the clip's ends (someone crossing mid-set is no walk to the phone)
  const gone = (m: Moment | undefined) => !!m && (m.kind === "off" || m.kind === "phone");
  const startT = moments[0]?.t0 ?? 0;
  const endT = moments[moments.length - 1]?.t1 ?? 0;
  let inEnd = -1;
  for (let i = 0; i < moments.length && moments[i].t0 - startT <= WALK_LOOK; i++) {
    if (!gone(moments[i])) continue;
    inEnd = i;
    while (gone(moments[inEnd + 1])) inEnd++;
    break;
  }
  let outStart = moments.length;
  for (let i = moments.length - 1; i > inEnd && endT - moments[i].t1 <= WALK_LOOK; i--) {
    if (!gone(moments[i])) continue;
    outStart = i;
    while (outStart - 1 > inEnd && gone(moments[outStart - 1])) outStart--;
    break;
  }
  // the lifting moment right next to a walk is its last step in or its first step out: kept, never what the set is measured by
  if (inEnd >= 0 && moments[inEnd + 1]?.kind === "lift") {
    moments[inEnd + 1].spill = true;
    moments[inEnd + 1].step = true;
  }
  if (outStart < moments.length && outStart - 1 > inEnd && moments[outStart - 1]?.kind === "lift") {
    moments[outStart - 1].spill = true;
    moments[outStart - 1].step = true;
  }
  return moments;
}

type Bout = { first: number; last: number; energy: number; peak: number; /** Still and off-the-bar seconds since the bout before it. */ idle: number; stray: number };

/** Runs of lifting: split by a pause over LIFT_GAP_MAX or movement off the bar over LIFT_STRAY_MAX. */
function liftBouts(moments: Moment[]): Bout[] {
  const out: Bout[] = [];
  let cur: Bout | null = null;
  let idle = 0;
  let stray = 0;
  moments.forEach((m, i) => {
    const dt = Math.max(0, m.t1 - m.t0);
    if (m.kind !== "lift") {
      if (m.kind === "still") idle += dt;
      else stray += dt;
      return;
    }
    if (cur && idle + stray <= LIFT_GAP_MAX && stray <= LIFT_STRAY_MAX) {
      cur.last = i;
    } else {
      cur = { first: i, last: i, energy: 0, peak: 0, idle: out.length ? idle : Infinity, stray: out.length ? stray : Infinity };
      out.push(cur);
    }
    cur.energy += m.inside * dt;
    if (!m.spill) cur.peak = Math.max(cur.peak, m.inside);
    idle = 0;
    stray = 0;
  });
  return out;
}

/** The set's usual moment: three quarters of the way up its lifting moments, by how much of the bar's spot moved. */
function usualStrength(moments: Moment[], first: number, last: number): number {
  const xs: number[] = [];
  for (let i = first; i <= last; i++) if (moments[i].kind === "lift" && !moments[i].spill) xs.push(moments[i].inside);
  if (!xs.length) for (let i = first; i <= last; i++) if (moments[i].kind === "lift") xs.push(moments[i].inside);
  xs.sort((a, b) => a - b);
  return xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.75))] : 0;
}

/**
 * The set's run of moments: the bout with the most lifting, with the bouts
 * either side that are as strong and only a pause away (never a walk).
 */
export function liftRun(moments: Moment[]): { first: number; last: number; share: number; usual: number } | null {
  const bouts = liftBouts(moments);
  if (!bouts.length) return null;
  let main = 0;
  bouts.forEach((b, i) => {
    if (b.energy > bouts[main].energy) main = i;
  });
  const usual = usualStrength(moments, bouts[main].first, bouts[main].last);
  const joins = (b: Bout, gapIdle: number, gapStray: number) => gapIdle + gapStray <= LIFT_PAUSE_MAX && gapStray <= LIFT_CROSS_MAX && b.peak >= usual * JOIN_STRENGTH;
  let lo = main;
  let hi = main;
  while (lo > 0 && joins(bouts[lo - 1], bouts[lo].idle, bouts[lo].stray)) lo--;
  while (hi < bouts.length - 1 && joins(bouts[hi + 1], bouts[hi + 1].idle, bouts[hi + 1].stray)) hi++;
  let kept = 0;
  let total = 0;
  bouts.forEach((b, i) => {
    total += b.energy;
    if (i >= lo && i <= hi) kept += b.energy;
  });
  return { first: bouts[lo].first, last: bouts[hi].last, share: total > 0 ? kept / total : 0, usual };
}

/**
 * Where the set's own movement starts: the first stretch of lifting, moment
 * after moment (a beat's pause apart at most), that lasts (three moments or
 * more, as hard as the set's usual one or nearly) or is as hard as the
 * hardest stretch there is (a rep on its own between long breaths). A shift
 * of weight or a step while waiting is brief, and slighter than a rep.
 */
function firstHardStretch(moments: Moment[], first: number, last: number, usual: number): number {
  const stretches: { first: number; last: number; peak: number; count: number }[] = [];
  let cur: { first: number; last: number; peak: number; count: number } | null = null;
  for (let i = first; i <= last; i++) {
    const m = moments[i];
    if (m.kind !== "lift" || m.spill) continue;
    if (cur && m.t0 - moments[cur.last].t1 > HARD_GAP) cur = null;
    if (!cur) {
      cur = { first: i, last: i, peak: 0, count: 0 };
      stretches.push(cur);
    }
    cur.last = i;
    cur.count++;
    cur.peak = Math.max(cur.peak, m.inside);
  }
  const lasts = (st: { first: number; last: number }) => moments[st.last].t1 - moments[st.first].t0;
  let top = 0;
  for (const st of stretches) if (lasts(st) >= HARD_BRIEF) top = Math.max(top, st.peak);
  const hardAt = (from: number, to: number) => {
    for (let i = from; i <= to; i++) if (moments[i].kind === "lift" && !moments[i].spill && moments[i].inside >= usual * STRONG) return i;
    return -1;
  };
  // the stretch's first hard moment (a slight shift just before it, a beat's pause away, isn't the start)
  for (const st of stretches) {
    if (!((lasts(st) >= HARD_LASTS && st.peak >= usual * STRONG) || (lasts(st) >= HARD_BRIEF && st.peak >= top * HARD))) continue;
    const at = hardAt(st.first, st.last);
    if (at >= 0) return at;
  }
  // nothing lasts: the first hard moment
  const at = hardAt(first, last);
  return at >= 0 ? at : first;
}

export type LiftRead = {
  window: LiftWindow | null;
  /** Why there's no suggestion (or "found"). */
  why: "found" | "few-frames" | "sparse" | "handheld" | "no-movement" | "no-lift" | "unclear" | "short" | "nothing-to-cut";
};

/**
 * The part of the clip to keep: the lift with a moment either side, or no
 * window when there's no clear lift or nothing worth cutting (a clip that's
 * already just the lift keeps going as it is), with why.
 */
export function readLift(frames: LiftFrame[], w: number, h: number, duration: number): LiftRead {
  if (frames.length < 4 || !(duration > 0) || w * h < 16) return { window: null, why: "few-frames" };
  // read about a frame a second: closer frames show too little movement each to tell a shift of weight from a rep
  const spaced: LiftFrame[] = [];
  for (const f of frames) if (!spaced.length || f.t - spaced[spaced.length - 1].t >= FRAME_GAP - 1e-6) spaced.push(f);
  if (spaced.length < 4) return { window: null, why: "few-frames" };
  // frames too far apart to tell a rep from a pause over much of the clip: no suggestion rather than a careless one
  let apart = 0;
  for (let i = 1; i < spaced.length; i++) if (spaced[i].t - spaced[i - 1].t > FRAME_GAP_MAX) apart += spaced[i].t - spaced[i - 1].t;
  if (apart > (spaced[spaced.length - 1].t - spaced[0].t) * 0.25) return { window: null, why: "sparse" };
  const masks = motionMasks(spaced);
  const walks = findWalks(spaced, masks);
  if (walks === "handheld") return { window: null, why: "handheld" };
  const spot = liftSpot(masks, w, h, walks);
  if (!spot) return { window: null, why: "no-movement" };
  const moments = classifyMoments(masks, w, h, spot);
  // a lot moving away from the bar in most moments that aren't the walks: the phone itself is moving
  const between = moments.filter((_, i) => i > spot.walkIn && (spot.walkOut < 0 || i < spot.walkOut));
  const wide = between.filter((m) => m.far > BIG_FAR || m.kind === "phone").length;
  if (between.length >= 4 && wide / between.length >= HANDHELD_MOMENTS) return { window: null, why: "handheld" };
  const run = liftRun(moments);
  if (!run) return { window: null, why: "no-lift" };
  // the lift has to be clear: most of the lifting in the part kept
  if (run.share < 0.5) return { window: null, why: "unclear" };
  let first = run.first;
  let last = run.last;
  // held to a few seconds around its hard movements: a wait at the bar before the first, the standing around after the last, go
  const firstHard = firstHardStretch(moments, first, last, run.usual);
  let lastHard = last;
  while (lastHard > first && !(moments[lastHard].kind === "lift" && !moments[lastHard].spill && moments[lastHard].inside >= run.usual * STRONG)) lastHard--;
  while (first < firstHard && moments[firstHard].t0 - moments[first].t0 > LIFT_LEAD_MAX) first++;
  while (last > lastHard && moments[last].t1 - moments[lastHard].t1 > LIFT_TAIL_MAX) last--;
  while (first < last && moments[first].kind !== "lift") first++;
  while (last > first && moments[last].kind !== "lift") last--;
  // a first or last moment that's half walking (arriving at the bar, leaving it) counts from its middle
  const a = moments[first];
  const b = moments[last];
  // the walk's last step in counts from its middle; the end is never halved (the bar going down is in that moment too),
  // and when the walk back starts in the very next moment, half of that one is kept as well
  const from = a.step && a.t1 - a.t0 <= SPARSE ? (a.t0 + a.t1) / 2 : a.t0;
  const next = moments[last + 1];
  const to = b.t1 + (next && next.kind === "off" ? Math.min(0.5, (next.t1 - next.t0) / 2) : 0);
  if (to - from < LIFT_MIN) return { window: null, why: "short" };
  const start = Math.max(0, Math.round((from - LIFT_PAD_BEFORE) * 100) / 100);
  const end = Math.min(duration, Math.round((to + LIFT_PAD_AFTER) * 100) / 100);
  // worth a suggestion only when it cuts something you'd notice
  const cut = duration - (end - start);
  if (cut < Math.max(1.5, duration * 0.08)) return { window: null, why: "nothing-to-cut" };
  return { window: { start, end }, why: "found" };
}

export function liftWindow(frames: LiftFrame[], w: number, h: number, duration: number): LiftWindow | null {
  return readLift(frames, w, h, duration).window;
}
