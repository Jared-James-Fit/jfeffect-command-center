/**
 * Where the lift is in a clip (pure, tested): the part worth keeping when a
 * set is filmed with the walk to the bar, the wait and the walk back to the
 * phone around it. It reads tiny greyscale frames, a frame or two a second
 * (lift.ts decodes them on the phone), and never guesses what it can't see:
 * a clip that's all lifting, shot handheld, or with nothing clear going on
 * gets no suggestion.
 *
 *   1. what moved between each pair of frames (a mask: brighter or darker by
 *      more than the whole picture's own shift, so the phone adjusting its
 *      exposure doesn't count)
 *   2. where the lifting happens: the spot the movement keeps coming back to
 *      (each moment counts once however much moved, so a walk past the lens
 *      can't outweigh a set of reps), its largest patch, a little wider
 *   3. each moment: still, the lift (moving there and not much elsewhere),
 *      off the bar (moving elsewhere: walking to or from the phone), or the
 *      phone itself (most of the picture moving: picked up, or someone right
 *      in front of the lens)
 *   4. the lift: the longest run of lifting, through short pauses (a breath
 *      at the bottom, the moment before the first rep) and short steps off
 *      the bar (a first or last moment that's half walking, arriving at the
 *      bar or leaving it, counts from its middle), with a moment kept either
 *      side
 */

export type LiftFrame = { t: number; px: Uint8Array };
export type LiftWindow = { start: number; end: number };
export type MomentKind = "still" | "lift" | "off" | "phone";

/** Kept either side of the lift (the unrack before it, the rack after it). */
export const LIFT_PAD_BEFORE = 0.5;
export const LIFT_PAD_AFTER = 0.8;
/** A pause inside the lift this long or shorter stays in it. */
export const LIFT_GAP_MAX = 4;
/** Movement away from the bar this long or shorter stays in it (a step back, a plate). */
export const LIFT_STRAY_MAX = 1.6;
/** A lift is at least this long. */
export const LIFT_MIN = 2.5;

/** Grey levels a pixel must change by, over the frame's own typical change, to count as moving. */
const DIFF_T = 24;
/** Share of the picture moving for "something's happening". */
const ACTIVE_MIN = 0.012;
/** More than this moving: the phone itself, or someone right in front of it. */
const PHONE_MOVED = 0.55;
/** The lift's first or last moment with this much moving away from the bar is half walking: it counts from its middle. */
const EDGE_STRAY = 0.08;

export type Moment = { t0: number; t1: number; kind: MomentKind; inside: number; outside: number; area: number };

/**
 * The whole picture's shift between two frames: the median of b − a, signed.
 * The phone re-exposing moves every pixel the same way (taken out); the phone
 * itself moving or someone walking moves them both ways (left in).
 */
function medianShift(a: Uint8Array, b: Uint8Array): number {
  const hist = new Uint32Array(511);
  for (let i = 0; i < a.length; i++) hist[b[i] - a[i] + 255]++;
  let seen = 0;
  const half = a.length / 2;
  for (let v = 0; v < 511; v++) {
    seen += hist[v];
    if (seen >= half) return v - 255;
  }
  return 0;
}

/** What moved between each pair of frames. */
export function motionMasks(frames: LiftFrame[]): { t0: number; t1: number; mask: Uint8Array; count: number }[] {
  const out: { t0: number; t1: number; mask: Uint8Array; count: number }[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].px;
    const b = frames[i].px;
    if (a.length !== b.length || !a.length) continue;
    const shift = medianShift(a, b);
    const mask = new Uint8Array(a.length);
    let count = 0;
    for (let p = 0; p < a.length; p++) {
      if (Math.abs(b[p] - a[p] - shift) > DIFF_T) {
        mask[p] = 1;
        count++;
      }
    }
    out.push({ t0: frames[i - 1].t, t1: frames[i].t, mask, count });
  }
  return out;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * Where the lifting happens: the spot movement keeps coming back to. Each
 * moment with something going on adds up to one, spread over what moved, so
 * a set of reps in one place builds a peak and a walk smears thin. The
 * largest patch above a third of the peak, a cell wider each way.
 */
export function liftZone(masks: { mask: Uint8Array; count: number }[], w: number, h: number): Box | null {
  const n = w * h;
  const heat = new Float32Array(n);
  let used = 0;
  for (const m of masks) {
    const share = m.count / n;
    if (share < ACTIVE_MIN || share > PHONE_MOVED) continue;
    const add = 1 / m.count;
    for (let p = 0; p < n; p++) if (m.mask[p]) heat[p] += add;
    used++;
  }
  if (!used) return null;
  // a 3×3 blur, so a patch holds together
  const blur = new Float32Array(n);
  let max = 0;
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
          s += heat[yy * w + xx];
          c++;
        }
      }
      const v = s / c;
      blur[y * w + x] = v;
      if (v > max) max = v;
    }
  }
  if (!(max > 0)) return null;
  const hot = new Uint8Array(n);
  for (let p = 0; p < n; p++) hot[p] = blur[p] >= max / 3 ? 1 : 0;
  // the largest patch (4-connected), by its heat
  const seen = new Uint8Array(n);
  let best: { box: Box; heat: number } | null = null;
  const stack: number[] = [];
  for (let p = 0; p < n; p++) {
    if (!hot[p] || seen[p]) continue;
    let box: Box = { x0: w, y0: h, x1: -1, y1: -1 };
    let sum = 0;
    stack.push(p);
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w;
      const y = (q - x) / w;
      sum += blur[q];
      box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
      const next = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
      for (const r of next) if (r >= 0 && hot[r] && !seen[r]) {
        seen[r] = 1;
        stack.push(r);
      }
    }
    if (!best || sum > best.heat) best = { box, heat: sum };
  }
  if (!best) return null;
  const b = best.box;
  return { x0: Math.max(0, b.x0 - 1), y0: Math.max(0, b.y0 - 1), x1: Math.min(w - 1, b.x1 + 1), y1: Math.min(h - 1, b.y1 + 1) };
}

/** Each moment between two frames: still, the lift, off the bar, or the phone itself. */
export function classifyMoments(masks: { t0: number; t1: number; mask: Uint8Array; count: number }[], w: number, h: number, zone: Box): Moment[] {
  const n = w * h;
  const zoneArea = (zone.x1 - zone.x0 + 1) * (zone.y1 - zone.y0 + 1);
  // the lift fills most of the picture (filmed up close): moving anywhere short of the whole picture is the lift
  const closeUp = zoneArea / n > 0.7;
  return masks.map((m) => {
    let inZone = 0;
    for (let y = zone.y0; y <= zone.y1; y++) for (let x = zone.x0; x <= zone.x1; x++) inZone += m.mask[y * w + x];
    const area = m.count / n;
    const inside = inZone / zoneArea;
    const outside = n > zoneArea ? (m.count - inZone) / (n - zoneArea) : 0;
    let kind: MomentKind;
    if (area > PHONE_MOVED) kind = "phone";
    else if (area < ACTIVE_MIN && inside < 0.03) kind = "still";
    else if (inside >= 0.03 && (closeUp || outside <= Math.max(0.02, inside * 0.5))) kind = "lift";
    else kind = "off";
    return { t0: m.t0, t1: m.t1, kind, inside, outside, area };
  });
}

/** The lift's run of moments: through short pauses and short steps off the bar, the one with the most lifting in it. */
export function liftRun(moments: Moment[]): { first: number; last: number; share: number } | null {
  type Run = { first: number; last: number; score: number };
  const runs: Run[] = [];
  let cur: Run | null = null;
  let still = 0;
  let stray = 0;
  const close = () => {
    if (cur) runs.push(cur);
    cur = null;
  };
  moments.forEach((m, i) => {
    const dt = Math.max(0, m.t1 - m.t0);
    if (m.kind === "lift") {
      if (!cur) cur = { first: i, last: i, score: 0 };
      cur.last = i;
      cur.score += m.inside * dt;
      still = 0;
      stray = 0;
      return;
    }
    if (!cur) return;
    if (m.kind === "phone") return close();
    if (m.kind === "still") {
      still += dt;
      if (still > LIFT_GAP_MAX) close();
      return;
    }
    stray += dt;
    still += dt;
    if (stray > LIFT_STRAY_MAX || still > LIFT_GAP_MAX) close();
  });
  close();
  if (!runs.length) return null;
  const total = runs.reduce((s, r) => s + r.score, 0);
  const best = runs.reduce((a, b) => (b.score > a.score ? b : a));
  return { first: best.first, last: best.last, share: total > 0 ? best.score / total : 0 };
}

/**
 * The part of the clip to keep: the lift with a moment either side, or null
 * when there's no clear lift or nothing worth cutting (a clip that's already
 * just the lift keeps going as it is).
 */
export function liftWindow(frames: LiftFrame[], w: number, h: number, duration: number): LiftWindow | null {
  if (frames.length < 4 || !(duration > 0) || w * h < 16) return null;
  const masks = motionMasks(frames);
  const zone = liftZone(masks, w, h);
  if (!zone) return null;
  const moments = classifyMoments(masks, w, h, zone);
  const run = liftRun(moments);
  // the lift has to be clear: most of the lifting in one run
  if (!run || run.share < 0.5) return null;
  // a first or last moment that's half walking (arriving at the bar, leaving it) counts from its middle
  const half = (m: Moment) => m.outside > EDGE_STRAY;
  const first = moments[run.first];
  const last = moments[run.last];
  const from = half(first) ? (first.t0 + first.t1) / 2 : first.t0;
  const to = half(last) ? (last.t0 + last.t1) / 2 : last.t1;
  if (to - from < LIFT_MIN) return null;
  const start = Math.max(0, Math.round((from - LIFT_PAD_BEFORE) * 100) / 100);
  const end = Math.min(duration, Math.round((to + LIFT_PAD_AFTER) * 100) / 100);
  // worth a suggestion only when it cuts something you'd notice
  const cut = duration - (end - start);
  if (cut < Math.max(1.5, duration * 0.08)) return null;
  return { start, end };
}
