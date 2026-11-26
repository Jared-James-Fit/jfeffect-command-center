/**
 * Bar speed from however the athlete filmed it (pure; frames in memory), for
 * the server's reader (scripts/velocity-worker). The plate engine (engine.ts)
 * finds a plate by its round face and refuses anything it can't vouch for;
 * real set videos are filmed front-on (the plates edge-on: tall dark stacks,
 * never circles), from the foot of the bench, or turned so far the face's rim
 * can't be measured. This reads those as an estimate, never a guess:
 *
 *   1. where the bar's end could be: the plate engine's own circles (any
 *      confidence) and dark, rigid blobs that move up and down through the
 *      set (`stackTracks`: a stack of black plates seen from the front);
 *   2. each followed through every frame by its own picture (`followBox`:
 *      normalised cross-correlation against the first picture and a recent
 *      one, never further than a loaded bar can move);
 *   3. the scale from the plate's height (`measureExtent`): a plate's
 *      vertical extent is its true 450 mm whichever way round the phone is
 *      turned (front-on, side-on, anything between), so vertical speed is
 *      read the same way at any yaw;
 *   4. read with the plate engine's own kinematics (analyzeTrack), and kept
 *      only when it is plainly the set: every rep complete and read, the rep
 *      count the athlete logged (one either way), each rep's range one the
 *      movement travels, the tolerant logging rules (quality.ts).
 *
 * Every read made here is an estimate (velocity tier 'estimated', note
 * "estimated_track"): it can be corrected, flagged or left out like any read.
 */
import { analyzeTrack, type LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { DEFAULT_PLATE, type PlateSize } from "@/lib/lift-analysis/calibrate";
import { proposePlate } from "@/lib/lift-analysis/detect";
import { MOVEMENT_ROM_MM, type Movement } from "@/lib/lift-analysis/exercise";
import { median, percentile, type Frame } from "@/lib/lift-analysis/image";
import { calibratedSetMean } from "@/lib/lift-analysis/quality";
import type { TrackPoint } from "@/lib/lift-analysis/track";
import { velocityVerdict } from "@/lib/lift-analysis/verdict";

export const ESTIMATE_ENGINE = "bar-path/8e";

/* ── where the bar's end could be ──────────────────────────────────────── */

export type Blob = { t: number; fi: number; x: number; y: number; w: number; h: number; dark: number };

/** A dark, solid, roughly upright blob (a plate stack front-on, a dark plate's face): per frame. */
export function darkBlobs(f: Frame, fi = 0, minRun = 0): Blob[] {
  const { w: W, h: H, px } = f;
  const n = W * H;
  const T = Math.max(22, Math.min(70, percentile(px, 0.2)));
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = px[i] < T ? 1 : 0;
  // a plate stack is wider than a rack's upright: keep only dark runs at least `minRun` across
  // (a horizontal opening), so a stack that passes behind a dark upright isn't one blob with it
  if (minRun > 1)
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let x = 0;
      while (x < W) {
        if (!m[o + x]) {
          x++;
          continue;
        }
        let e = x;
        while (e < W && m[o + e]) e++;
        if (e - x < minRun) for (let k = x; k < e; k++) m[o + k] = 0;
        x = e;
      }
    }
  // opening (3 × 3): thin dark lines (a rack's edge, the bar's shadow) go
  const er = new Uint8Array(n);
  for (let y = 1; y < H - 1; y++) {
    const o = y * W;
    for (let x = 1; x < W - 1; x++) {
      const i = o + x;
      er[i] =
        m[i] & m[i - 1] & m[i + 1] & m[i - W] & m[i + W] & m[i - W - 1] & m[i - W + 1] & m[i + W - 1] & m[i + W + 1];
    }
  }
  const op = new Uint8Array(n);
  for (let y = 1; y < H - 1; y++) {
    const o = y * W;
    for (let x = 1; x < W - 1; x++) {
      if (!er[o + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) op[o + dy * W + x + dx] = 1;
    }
  }
  const lab = new Int32Array(n).fill(-1);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!op[s] || lab[s] >= 0) continue;
    let x0 = W, x1 = -1, y0 = H, y1 = -1, cnt = 0, sx = 0, sy = 0, sum = 0;
    lab[s] = s;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      cnt++;
      sx += x;
      sy += y;
      sum += px[p];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && op[p - 1] && lab[p - 1] < 0) (lab[p - 1] = s), stack.push(p - 1);
      if (x < W - 1 && op[p + 1] && lab[p + 1] < 0) (lab[p + 1] = s), stack.push(p + 1);
      if (y > 0 && op[p - W] && lab[p - W] < 0) (lab[p - W] = s), stack.push(p - W);
      if (y < H - 1 && op[p + W] && lab[p + W] < 0) (lab[p + W] = s), stack.push(p + W);
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const fill = cnt / (bw * bh);
    if (bh < 0.04 * H || bw < 0.025 * W || bh > 0.4 * H || bw > 0.4 * W) continue;
    if (bh / bw < 0.55 || bh / bw > 5 || fill < 0.5) continue;
    out.push({ t: f.t, fi, x: sx / cnt, y: sy / cnt, w: bw, h: bh, dark: sum / cnt });
  }
  return out;
}

export type BlobTrack = {
  hits: Blob[];
  w: number;
  h: number;
  /** Vertical / horizontal travel (10th–90th percentile) in its own heights / widths. */
  travelY: number;
  travelX: number;
  /** Spread of its height (MAD ÷ median): a rigid stack keeps its size. */
  sizeSpread: number;
  score: number;
};

/** The same blob from frame to frame (samples a few a second): near where it was, about its size. */
export function stackTracks(samples: Frame[], minRun = 0): BlobTrack[] {
  type Open = { hits: Blob[]; last: Blob };
  const open: Open[] = [];
  const done: Open[] = [];
  samples.forEach((f, fi) => {
    const blobs = darkBlobs(f, fi, minRun);
    const used = new Set<number>();
    for (const tr of open) {
      const l = tr.last;
      let best = -1;
      let cost = Infinity;
      blobs.forEach((b, i) => {
        if (used.has(i)) return;
        const dt = Math.max(0.05, b.t - l.t);
        const dx = Math.abs(b.x - l.x);
        const dy = Math.abs(b.y - l.y);
        if (dx > Math.max(0.7 * l.w, 6) + 0.2 * l.w * dt) return;
        if (dy > Math.min(4.5 * l.h, Math.max(10, 6 * l.h * dt))) return;
        if (Math.abs(b.h / l.h - 1) > 0.4 || Math.abs(b.w / l.w - 1) > 0.5) return;
        const c = dx / l.w + dy / (2 * l.h) + 2 * Math.abs(b.h / l.h - 1) + Math.abs(b.w / l.w - 1);
        if (c < cost) {
          cost = c;
          best = i;
        }
      });
      if (best >= 0) {
        used.add(best);
        tr.hits.push(blobs[best]);
        tr.last = blobs[best];
      }
    }
    blobs.forEach((b, i) => {
      if (!used.has(i)) open.push({ hits: [b], last: b });
    });
    // close what hasn't been seen for a while
    for (let i = open.length - 1; i >= 0; i--)
      if (f.t - open[i].last.t > 1.6) done.push(...open.splice(i, 1));
  });
  done.push(...open);
  const n = samples.length;
  const out: BlobTrack[] = [];
  for (const tr of done) {
    const hs = tr.hits;
    if (hs.length < Math.max(5, 0.12 * n)) continue;
    const h = median(hs.map((b) => b.h));
    const w = median(hs.map((b) => b.w));
    const ys = hs.map((b) => b.y);
    const xs = hs.map((b) => b.x);
    const travelY = (percentile(ys, 0.9) - percentile(ys, 0.1)) / h;
    const travelX = (percentile(xs, 0.9) - percentile(xs, 0.1)) / w;
    const sizeSpread = (1.4826 * median(hs.map((b) => Math.abs(b.h - h)))) / h;
    if (travelY < 0.5 || sizeSpread > 0.3) continue;
    const score = hs.length * Math.min(travelY, 3) * (1 - sizeSpread) * Math.sqrt(h);
    out.push({ hits: hs, w, h, travelY, travelX, sizeSpread, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ── following it ──────────────────────────────────────────────────────── */

export type BoxSeed = { t: number; x: number; y: number; hw: number; hh: number; from: string };

type Tpl = { w: number; h: number; z: Float32Array; norm: number };

function makeTpl(f: Frame, cx: number, cy: number, hw: number, hh: number): Tpl | null {
  const x0 = Math.round(cx - hw);
  const y0 = Math.round(cy - hh);
  const w = 2 * Math.round(hw) + 1;
  const h = 2 * Math.round(hh) + 1;
  if (x0 < 0 || y0 < 0 || x0 + w > f.w || y0 + h > f.h) return null;
  const z = new Float32Array(w * h);
  let s = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s += z[y * w + x] = f.px[(y0 + y) * f.w + x0 + x];
  const mean = s / (w * h);
  let ss = 0;
  for (let i = 0; i < z.length; i++) {
    z[i] -= mean;
    ss += z[i] * z[i];
  }
  const norm = Math.sqrt(ss);
  return norm > 1e-3 * w * h ? { w, h, z, norm } : null;
}

/** Normalised cross-correlation of a template centred at (cx, cy) (integer px). */
function nccAt(f: Frame, t: Tpl, cx: number, cy: number): number {
  const x0 = cx - (t.w >> 1);
  const y0 = cy - (t.h >> 1);
  if (x0 < 0 || y0 < 0 || x0 + t.w > f.w || y0 + t.h > f.h) return -2;
  let s = 0;
  let si = 0;
  let si2 = 0;
  const W = f.w;
  const px = f.px;
  const z = t.z;
  let k = 0;
  for (let y = 0; y < t.h; y++) {
    let o = (y0 + y) * W + x0;
    for (let x = 0; x < t.w; x++, o++, k++) {
      const v = px[o];
      s += v * z[k];
      si += v;
      si2 += v * v;
    }
  }
  const n = t.w * t.h;
  const varI = si2 - (si * si) / n;
  if (varI <= 1e-6) return -2;
  return s / (Math.sqrt(varI) * t.norm);
}

type Match = { x: number; y: number; s0: number; sr: number; score: number };

/**
 * The best place for a bank of templates around (px, py) (pure): `s0` is the
 * first template's score there (never forgotten), `score` the best of any.
 * A coarse grid at `step`, refined to the pixel, then to a fraction of one.
 */
function searchBox(
  f: Frame,
  bank: Tpl[],
  px: number,
  py: number,
  sx: number,
  sy: number,
  step: number,
): Match {
  let best: Match = { x: px, y: py, s0: -2, sr: -2, score: -2 };
  const cx0 = Math.round(px);
  const cy0 = Math.round(py);
  const score = (x: number, y: number): Match => {
    const s0 = nccAt(f, bank[0], x, y);
    let sr = -2;
    for (let k = 1; k < bank.length; k++) sr = Math.max(sr, nccAt(f, bank[k], x, y));
    return { x, y, s0, sr, score: Math.max(s0, 0.97 * sr) };
  };
  for (let dy = -sy; dy <= sy; dy += step)
    for (let dx = -sx; dx <= sx; dx += step) {
      const m = score(cx0 + dx, cy0 + dy);
      if (m.score > best.score) best = m;
    }
  if (step > 1) {
    const c = best;
    for (let dy = -step + 1; dy < step; dy++)
      for (let dx = -step + 1; dx < step; dx++) {
        if (!dx && !dy) continue;
        const m = score(c.x + dx, c.y + dy);
        if (m.score > best.score) best = m;
      }
  }
  // sub-pixel: a parabola through the neighbours, each way
  const sub = (a: number, b: number, c: number) => {
    const d = a - 2 * b + c;
    return d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
  };
  const f0 = best.score;
  const up = score(best.x, best.y - 1).score;
  const dn = score(best.x, best.y + 1).score;
  const lf = score(best.x - 1, best.y).score;
  const rt = score(best.x + 1, best.y).score;
  const ox = lf > -2 && rt > -2 ? sub(lf, f0, rt) : 0;
  const oy = up > -2 && dn > -2 ? sub(up, f0, dn) : 0;
  return { ...best, x: best.x + ox, y: best.y + oy };
}

/** The template's half size around a seed: the blob with a margin of what's around it (its edges are the picture). */
export function templateHalf(seed: BoxSeed) {
  const m = Math.max(2, Math.round(0.25 * Math.min(seed.hw, seed.hh)));
  return { tw: Math.round(seed.hw) + m, th: Math.round(seed.hh) + m };
}

/** A template that fits in the frame: the margin given up at the frame's edge rather than the template. */
function fitTpl(f: Frame, cx: number, cy: number, tw: number, th: number): Tpl | null {
  const w = Math.min(tw, Math.floor(cx) - 1, f.w - 2 - Math.ceil(cx));
  const h = Math.min(th, Math.floor(cy) - 1, f.h - 2 - Math.ceil(cy));
  if (w < 0.6 * tw || h < 0.6 * th) return null;
  return makeTpl(f, cx, cy, w, h);
}

/** A match at least this good is the plate; a weaker one only exactly where its motion says it is. */
export const BOX_ACCEPT = 0.55;
export const BOX_WEAK = 0.38;
/** A picture of it kept from another height of its travel when matched at least this well. */
const BOX_BANK = 0.62;
const BANK_MAX = 7;

/**
 * The seed followed through every frame, forward then backward from it, by
 * its pictures: the first one (never forgotten, so it can't drift onto the
 * lifter), pictures kept from other heights of its travel (the background
 * behind a plate changes as it moves: a squat's bottom is in front of the
 * rack, its top in front of the wall) and a recent one. A weaker match
 * counts only exactly where the bar's motion puts it and never starts a
 * track again after it was lost. Never further in a frame than a loaded
 * bar moves (`maxPx` a frame, from the seed's size: a 450 mm plate at
 * ~2.8 m/s), sideways much less.
 */
export function followBox(
  frames: Frame[],
  seed: BoxSeed,
  debug?: (i: number, m: { score: number; s0: number; sr: number; x: number; y: number }) => void,
): TrackPoint[] {
  const N = frames.length;
  const out: TrackPoint[] = frames.map((f) => ({
    t: f.t,
    x: NaN,
    y: NaN,
    r: NaN,
    a: NaN,
    b: NaN,
    conf: 0,
    found: false,
  }));
  if (!N) return out;
  let i0 = 0;
  for (let i = 1; i < N; i++) if (Math.abs(frames[i].t - seed.t) < Math.abs(frames[i0].t - seed.t)) i0 = i;
  const { tw, th } = templateHalf(seed);
  const t0 = fitTpl(frames[i0], seed.x, seed.y, tw, th);
  if (!t0) return out;
  const fps = N > 1 ? (N - 1) / Math.max(1e-3, frames[N - 1].t - frames[0].t) : 30;
  // a 450 mm plate is 2·hh px (the blob is the plate's dark core: hh is if anything small, so this is generous)
  const maxPx = Math.max(3, Math.ceil((1.4 * 2800 * (2 * seed.hh)) / 450 / fps) + 1);
  const side = Math.max(2, Math.ceil(0.35 * maxPx) + 1);
  out[i0] = { t: frames[i0].t, x: seed.x, y: seed.y, r: seed.hh, a: seed.hw, b: seed.hh, conf: 1, found: true };
  // the first picture, then pictures from other heights (shared by both passes)
  const bank: { tpl: Tpl; y: number }[] = [{ tpl: t0, y: seed.y }];
  for (const dir of [1, -1] as const) {
    let recent: Tpl | null = null;
    let lastI = i0;
    let px = seed.x;
    let py = seed.y;
    let vx = 0;
    let vy = 0;
    let lost = 0;
    let since = 0;
    let seen = 0;
    let looked = 0;
    for (let i = i0 + dir; i >= 0 && i < N; i += dir) {
      // a candidate that's mostly lost isn't the bar: stop spending time on it
      if (++looked > 90 && seen < 0.25 * looked) break;
      const f = frames[i];
      const tpls = [...bank.map((b) => b.tpl), ...(recent ? [recent] : [])];
      const k = i - lastI;
      const ex = px + vx * k;
      const ey = py + vy * k;
      let m: Match;
      if (lost <= 4) {
        const widen = 1 + lost;
        const sy = Math.min(Math.round(0.3 * f.h), maxPx * widen);
        const sx = Math.min(Math.round(0.2 * f.w), side * widen);
        m = searchBox(f, tpls, ex, ey, sx, sy, sy > 6 ? 2 : 1);
      } else if (lost % 4 === 0) {
        // lost for a while: look again around where it was last, wider and coarser, every few frames
        m = searchBox(f, tpls, px, py, Math.round(0.12 * f.w), Math.round(0.3 * f.h), 3);
        if (m.score < 0.7) m = { ...m, score: -2 };
      } else {
        m = { x: px, y: py, s0: -2, sr: -2, score: -2 };
      }
      debug?.(i, m);
      const near = Math.abs(m.y - ey) <= 0.6 * maxPx + 1 && Math.abs(m.x - ex) <= side + 1;
      const strong = m.score >= BOX_ACCEPT && (m.s0 >= 0.2 || m.sr >= BOX_BANK);
      const weak = !strong && lost === 0 && near && m.score >= BOX_WEAK;
      if (strong || weak) {
        const nvx = (m.x - px) / Math.abs(k);
        const nvy = (m.y - py) / Math.abs(k);
        // speed limit: never further than the bar can move in that time
        if (Math.abs(nvy) <= maxPx * 1.05 && Math.abs(nvx) <= side * 1.5) {
          vx = 0.5 * vx + 0.5 * (m.x - px) / k;
          vy = 0.5 * vy + 0.5 * (m.y - py) / k;
          px = m.x;
          py = m.y;
          lastI = i;
          lost = 0;
          seen++;
          out[i] = {
            t: f.t,
            x: m.x,
            y: m.y,
            r: seed.hh,
            a: seed.hw,
            b: seed.hh,
            conf: weak ? 0.3 : Math.max(0.4, Math.min(1, (m.score - 0.35) / 0.5)),
            found: true,
          };
          if (strong) {
            since++;
            if (since >= 8 && m.score >= 0.78) {
              const nt = fitTpl(f, m.x, m.y, tw, th);
              if (nt) recent = nt;
              since = 0;
            }
            if (m.score >= BOX_BANK && bank.length < BANK_MAX && bank.every((b) => Math.abs(b.y - m.y) > 0.5 * th)) {
              const nt = fitTpl(f, m.x, m.y, tw, th);
              if (nt) bank.push({ tpl: nt, y: m.y });
            }
          }
          continue;
        }
      }
      lost++;
      vx *= 0.5;
      vy *= 0.5;
    }
  }
  return out;
}

/* ── the scale: the plate's height ─────────────────────────────────────── */

export type Extent = { a: number; b: number; relA: number; relB: number; frames: number; faint: boolean };

/**
 * One edge each way from the centre along a profile (pure): the outermost
 * clear step out of the plate's own level (at least half the strongest one
 * in the window), where the outside differs from the plate by a clear amount.
 */
export function profileEdges(
  p: Float64Array,
  c: number,
  half: number,
): { lo: number; hi: number; contrast: number } | null {
  const n = p.length;
  const g = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) g[i] = (p[i + 1] - p[i - 1]) / 2;
  const inside: number[] = [];
  for (let i = Math.round(c - 0.75 * half); i <= Math.round(c + 0.75 * half); i++)
    if (i >= 0 && i < n && Math.abs(i - c) >= 0.25 * half) inside.push(p[i]);
  if (inside.length < 4) return null;
  const level = median(inside);
  const edge = (from: number, to: number, sgn: 1 | -1) => {
    // walking outward from the centre: sgn = -1 upward / leftward, +1 downward / rightward
    let strongest = 0;
    for (let i = from; sgn > 0 ? i <= to : i >= to; i += sgn) if (i > 0 && i < n - 1) strongest = Math.max(strongest, Math.abs(g[i]));
    if (strongest < 4) return null;
    let found = -1;
    let k = 0;
    for (let i = from; sgn > 0 ? i <= to : i >= to; i += sgn) {
      if (i <= 0 || i >= n - 1) continue;
      if (Math.abs(g[i]) < 0.5 * strongest) continue;
      // a step out of the plate: what lies beyond differs from the plate's level
      const beyond = p[Math.max(0, Math.min(n - 1, i + sgn * 3))];
      if (Math.abs(beyond - level) < 12) continue;
      // keep the outermost; refine to the local gradient peak
      found = i;
      k = Math.abs(g[i]);
    }
    if (found < 0) return null;
    // sub-pixel: the peak of |g| around it
    let j = found;
    while (j + sgn > 0 && j + sgn < n - 1 && Math.abs(g[j + sgn]) > Math.abs(g[j])) j += sgn;
    while (j - sgn > 0 && j - sgn < n - 1 && Math.abs(g[j - sgn]) > Math.abs(g[j])) j -= sgn;
    const a = Math.abs(g[j - 1]);
    const b = Math.abs(g[j]);
    const d = Math.abs(g[j + 1]);
    const den = a - 2 * b + d;
    const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - d)) / den)) : 0;
    return { at: j + off, k };
  };
  const lo = edge(Math.round(c - 0.45 * half), Math.round(c - 1.9 * half), -1);
  const hi = edge(Math.round(c + 0.45 * half), Math.round(c + 1.9 * half), 1);
  if (!lo || !hi) return null;
  return { lo: lo.at, hi: hi.at, contrast: Math.min(lo.k, hi.k) };
}

/** A vertical (or horizontal) profile through (cx, cy): the mean over a band of columns (rows). */
function profile(f: Frame, cx: number, cy: number, along: "y" | "x", half: number, band: number) {
  const len = Math.round(2.2 * half);
  const p = new Float64Array(2 * len + 1);
  const b = Math.max(1, Math.round(band));
  for (let k = -len; k <= len; k++) {
    let s = 0;
    let c = 0;
    for (let j = -b; j <= b; j++) {
      const x = Math.round(along === "y" ? cx + j : cx + k);
      const y = Math.round(along === "y" ? cy + k : cy + j);
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      s += f.px[y * f.w + x];
      c++;
    }
    p[k + len] = c ? s / c : NaN;
  }
  // edges of the frame: leave them out (NaN → the nearest value, never an edge)
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) p[i] = i ? p[i - 1] : 0;
  return { p, c: len };
}

/**
 * The plate's semi-axes from its edges in still frames (pure): the height
 * through its centre (a band of columns across its middle), the width the
 * same way across. Each frame's measurement must be about the size the
 * tracker followed (0.6–2.2 × the core it was seeded on: a dark core is
 * smaller than the plate), and frames are kept only where both edges show.
 * `hiRes` (optional) gives the same frame at more pixels (k × the working
 * size) for a sharper edge.
 */
export function measureExtent(
  frames: Frame[],
  points: TrackPoint[],
  seed: BoxSeed,
  hiRes?: { frameAt: (t: number) => Frame | null; k: number },
): Extent | null {
  const still: { i: number; v: number }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const p = points[i];
    const b = points[i + 1];
    if (!a.found || !p.found || !b.found) continue;
    const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1e-3, b.t - a.t);
    if (v <= 0.6 * seed.hh) still.push({ i, v });
  }
  if (still.length < 3) return null;
  const pick: number[] = [];
  const groups = Math.min(16, still.length);
  for (let g = 0; g < groups; g++) {
    const part = still.slice(Math.floor((g * still.length) / groups), Math.floor(((g + 1) * still.length) / groups));
    if (part.length) pick.push(part.reduce((x, y) => (y.v < x.v ? y : x)).i);
  }
  const hs: number[] = [];
  const ws: number[] = [];
  const contrast: number[] = [];
  for (const i of pick) {
    const pt = points[i];
    const k = hiRes?.k ?? 1;
    const f = (hiRes && hiRes.frameAt(pt.t)) || frames[i];
    const kk = f === frames[i] ? 1 : k;
    const cx = pt.x * kk;
    const cy = pt.y * kk;
    // the plate is at least the dark core, at most a bit over twice it
    const half = Math.max(seed.hh, seed.hw) * kk * 1.15;
    const vy = profile(f, cx, cy, "y", half, Math.max(1, 0.3 * seed.hw * kk));
    const ey = profileEdges(vy.p, vy.c, half);
    if (ey) {
      const H = (ey.hi - ey.lo) / kk;
      if (H >= 1.2 * seed.hh && H <= 4.4 * seed.hh) {
        hs.push(H / 2);
        contrast.push(ey.contrast);
      }
    }
    const hx = profile(f, cx, cy, "x", Math.max(seed.hw, 0.5 * seed.hh) * kk * 1.15, Math.max(1, 0.3 * seed.hh * kk));
    const ex = profileEdges(hx.p, hx.c, Math.max(seed.hw, 0.5 * seed.hh) * kk * 1.15);
    if (ex) {
      const Wd = (ex.hi - ex.lo) / kk;
      if (Wd >= 1.0 * seed.hw && Wd <= 4.4 * seed.hw) ws.push(Wd / 2);
    }
  }
  if (hs.length < 3) return null;
  const b = median(hs);
  // a measurement the frames agree on: within 10 % of the median
  const agree = hs.filter((v) => Math.abs(v / b - 1) <= 0.1);
  if (agree.length < Math.max(3, 0.5 * hs.length)) return null;
  const b2 = median(agree);
  const a = ws.length >= 3 ? median(ws) : seed.hw;
  const spread = (v: number[], m: number) =>
    v.length > 1 ? (1.4826 * median(v.map((x) => Math.abs(x - m)))) / Math.sqrt(v.length) : 0.05 * m;
  const faint = median(contrast) < 10;
  const edgePx = 0.5 / (hiRes?.k ?? 1);
  const relB = Math.hypot(spread(agree, b2) / b2, edgePx / b2, faint ? 0.03 : 0);
  const relA = Math.hypot(ws.length >= 3 ? spread(ws, a) / a : 0.1, edgePx / a);
  return { a: Math.min(a, b2 * 1.4), b: b2, relA, relB, frames: agree.length, faint };
}

/**
 * The plate's height from what moves with it (pure). Between a still frame
 * high in the lift (A) and one lower down (B), the plate's own pixels in A
 * reappear in B moved by exactly the bar's displacement, while whatever is
 * behind it stays put. A's top edge is where that stops above the plate's
 * centre; B's bottom edge is the same below it in B. Neither depends on
 * what colour the background is, only that it differs from the plate (a
 * dark gym behind a black stack still has texture and light), and neither
 * is ever covered by the other frame's plate (B is lower: A's top rows show
 * background in B; A is higher: B's bottom rows show background in A).
 * Measured in a band of columns across the plate's middle.
 */
export function measureByMotion(
  frames: Frame[],
  points: TrackPoint[],
  seed: BoxSeed,
): { b: number; relB: number; pairs: number } | null {
  const still: { i: number; v: number }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const p = points[i];
    const c = points[i + 1];
    if (!a.found || !p.found || !c.found || a.conf < 0.4 || p.conf < 0.4 || c.conf < 0.4) continue;
    const v = Math.hypot(c.x - a.x, c.y - a.y) / Math.max(1e-3, c.t - a.t);
    if (v <= 0.6 * seed.hh) still.push({ i, v });
  }
  if (still.length < 4) return null;
  // the stillest moments high and low in the travel: a lift is mostly at the top, a turnaround at the bottom
  const ys = still.map((s) => points[s.i].y);
  const yTop = percentile(ys, 0.1);
  const yBot = Math.max(...ys);
  // needs to have moved: at least a third of the core's height
  if (yBot - yTop < 0.66 * seed.hh) return null;
  const highs = still.filter((s) => points[s.i].y <= yTop + 0.15 * (yBot - yTop));
  const lows = still.filter((s) => points[s.i].y >= yBot - 0.15 * (yBot - yTop));
  const pick = (arr: typeof still, n: number) => {
    const out: number[] = [];
    for (let g = 0; g < Math.min(n, arr.length); g++) {
      const part = arr.slice(Math.floor((g * arr.length) / Math.min(n, arr.length)), Math.floor(((g + 1) * arr.length) / Math.min(n, arr.length)));
      if (part.length) out.push(part.reduce((x, y) => (y.v < x.v ? y : x)).i);
    }
    return out;
  };
  const A = pick(highs, 5);
  const B = pick(lows, 5);
  const band = Math.max(2, Math.round(0.35 * seed.hw));
  const reach = Math.round(3.2 * seed.hh);
  const ups: number[] = [];
  const downs: number[] = [];
  const edgeRow = (
    fa: Frame,
    fb: Frame,
    pa: TrackPoint,
    pb: TrackPoint,
    dir: -1 | 1,
  ): number | null => {
    // rows of fa outward from the plate's centre (dir −1: up), the share of the band that moved with it
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const W = fa.w;
    let lastPlate = -1;
    let gap = 0;
    let unknown = 0;
    for (let k = 0; k <= reach; k++) {
      const y = Math.round(pa.y + dir * k);
      const yb = Math.round(pa.y + dy + dir * k);
      if (y < 0 || y >= fa.h || yb < 0 || yb >= fb.h) break;
      let plate = 0;
      let bg = 0;
      let n = 0;
      for (let j = -band; j <= band; j++) {
        const x = Math.round(pa.x + j);
        const xb = Math.round(pa.x + dx + j);
        if (x < 0 || x >= W || xb < 0 || xb >= fb.w) continue;
        const va = fa.px[y * W + x];
        const dMoved = Math.abs(va - fb.px[yb * fb.w + xb]);
        const dStatic = Math.abs(va - fb.px[y * fb.w + x]);
        n++;
        // with the plate: the same in B where the bar took it, different from what B shows here;
        // the background: the same in B here, different where the bar went. Anything else says nothing
        // (a lit plate as grey as the wall behind it)
        if (dMoved <= 14 && dStatic >= 18) plate++;
        else if (dStatic <= 10 && dMoved >= 18) bg++;
      }
      if (!n) break;
      const informative = plate + bg;
      if (informative < 0.3 * n) {
        if (lastPlate >= 0 && ++unknown > Math.max(4, 0.4 * seed.hh)) break;
        continue;
      }
      if (plate >= 0.5 * informative) {
        lastPlate = k;
        gap = 0;
        unknown = 0;
      } else if (lastPlate >= 0 && ++gap > 1) break;
    }
    return lastPlate >= 0 ? lastPlate + 0.5 : null;
  };
  for (const ia of A)
    for (const ib of B) {
      const pa = points[ia];
      const pb = points[ib];
      const fa = frames[ia];
      const fb = frames[ib];
      if (pb.y - pa.y < 0.66 * seed.hh) continue;
      // A's top edge (above its centre), B's bottom edge (below its centre)
      const up = edgeRow(fa, fb, pa, pb, -1);
      const down = edgeRow(fb, fa, pb, pa, 1);
      if (up != null) ups.push(up);
      if (down != null) downs.push(down);
    }
  if (ups.length < 3 || downs.length < 3) return null;
  // an edge is only ever read short (a row that says nothing ends it early), never long: the upper quartile
  const upper = (v: number[]) => {
    const q = percentile(v, 0.75);
    const top = v.filter((x) => x >= percentile(v, 0.5));
    const sd = top.length > 1 ? (1.4826 * median(top.map((x) => Math.abs(x - q)))) / Math.sqrt(top.length) : 1;
    return { q, sd };
  };
  const U = upper(ups);
  const D = upper(downs);
  const H = U.q + D.q;
  if (!(H >= 1.2 * seed.hh && H <= 4.4 * seed.hh)) return null;
  const relB = Math.hypot(U.sd, D.sd, 1) / H;
  return { b: H / 2, relB, pairs: Math.min(ups.length, downs.length) };
}

/* ── the read ──────────────────────────────────────────────────────────── */

export type EstimateOptions = {
  dirHint?: "lower_first" | "lift_first";
  movement: Movement;
  /** The reps the athlete logged on the set (null: not logged). */
  expectedReps?: number | null;
  plate?: PlateSize & { confirmed?: boolean };
  /** Seeds from elsewhere (the plate engine's circles), tried with the stacks. */
  extraSeeds?: BoxSeed[];
  hiRes?: { frameAt: (t: number) => Frame | null; k: number };
  /** Called as each candidate is tried (the worker's progress). */
  onCandidate?: (i: number, n: number) => void;
  /** At most this many candidates followed. */
  maxCandidates?: number;
};

export type EstimateTry = {
  from: string;
  reps: number;
  complete: number;
  tracked: number;
  accepted: boolean;
  value: number | null;
  /**
   * The speeds this candidate's read allows, for the agreement check (speed ∝ 1 / plate height): a
   * blended size lies somewhere between its two measurements, so its speed is anywhere from the edges'
   * (low) to motion's (high); one measured size is its own value at both ends.
   */
  range?: { lo: number; hi: number } | null;
  why: string[];
};

export type EstimateResult =
  | { ok: true; analysis: LiftAnalysis; tried: EstimateTry[] }
  | { ok: false; why: "no_candidates" | "no_read" | "disagree"; tried: EstimateTry[]; best: LiftAnalysis | null };

/**
 * The range a rep of each movement travels, tighter than the logging rule's
 * (a plate's scale off by half fails it). A movement the name doesn't say
 * ("other") is never estimated: there's no range to check it against.
 */
export const ESTIMATE_ROM_MM: Record<Movement["kind"], [number, number] | null> = {
  squat: [380, 800],
  bench: [180, 520],
  deadlift: [300, 720],
  hinge: [250, 720],
  row: [150, 520],
  press: [300, 720],
  olympic: [500, 1900],
  other: null,
};
/** Every rep's range within this share of the set's median (a set is the same movement each rep). */
export const ESTIMATE_ROM_SPREAD = 0.15;
/** Two candidates that both read the set (left and right stacks, a stack and a circle) agree within this. */
export const ESTIMATE_AGREE = 0.12;
/** Motion and edge heights further apart than this are blended (geometric mean, half the gap as margin), see estimateRead. */
export const BLEND_FROM = 1.1;

/** Evenly spread frames, about `perSecond` a second. */
export function everyNth(frames: Frame[], perSecond: number): Frame[] {
  if (frames.length < 2) return frames.slice();
  const span = frames[frames.length - 1].t - frames[0].t;
  const fps = (frames.length - 1) / Math.max(1e-3, span);
  const step = Math.max(1, Math.round(fps / perSecond));
  const out: Frame[] = [];
  for (let i = 0; i < frames.length; i += step) out.push(frames[i]);
  return out;
}

/** Seeds from the plate engine's own finder: its key (any confidence) and its moving circles. */
export function circleSeeds(samples: Frame[]): BoxSeed[] {
  const p = proposePlate(samples);
  const out: BoxSeed[] = [];
  if (p.key)
    out.push({ t: p.key.t, x: p.key.x, y: p.key.y, hw: p.key.a, hh: p.key.b, from: `proposal:${p.confidence}` });
  for (const c of p.candidates.slice(0, 3))
    out.push({ t: c.t, x: c.x, y: c.y, hw: c.r, hh: c.r, from: "circle" });
  return out;
}

export function stackSeeds(samples: Frame[], max = 4, minRun = 0): BoxSeed[] {
  return stackTracks(samples, minRun)
    .slice(0, max)
    .map((tr) => {
      // the hit most like the track's own size, in its middle third of time
      const hs = tr.hits;
      const mid = hs.slice(Math.floor(hs.length / 3), Math.max(Math.floor(hs.length / 3) + 1, Math.ceil((2 * hs.length) / 3)));
      const pool = mid.length ? mid : hs;
      const b = pool.reduce((x, y) => (Math.abs(y.h - tr.h) + Math.abs(y.w - tr.w) < Math.abs(x.h - tr.h) + Math.abs(x.w - tr.w) ? y : x));
      return { t: b.t, x: b.x, y: b.y, hw: b.w / 2, hh: b.h / 2, from: minRun ? "wide" : "stack" };
    });
}

/**
 * Whether a read made here is plainly the set (pure): see the header. The
 * logged reps are the identity check (whatever else moves up and down in
 * the picture doesn't do the athlete's set), so they must be logged and match
 * (one short of a set of 4+ when followed cleanly: a recording that started
 * mid-rep), every rep complete, each one's range one the movement travels and
 * about the same as the others.
 */
export function plainlyTheSet(a: LiftAnalysis, movement: Movement, expectedReps: number | null | undefined): string[] {
  const why: string[] = [];
  const v = velocityVerdict(a);
  if (!v.accepted) why.push(...v.reasons);
  const complete = a.reps.filter((r) => r.complete).length;
  if (!a.reps.length) why.push("no_reps");
  if (complete !== a.reps.length) why.push("rep_incomplete");
  if (expectedReps == null || !(expectedReps > 0)) why.push("reps_not_logged");
  else if (complete !== expectedReps) {
    // one rep short of a set of 4+, followed cleanly through the clip, is a recording that started
    // or ended mid-rep (the server's own rule logs within one); anything else isn't this set
    const oneShort = expectedReps >= 4 && complete === expectedReps - 1 && a.quality.tracked >= 0.95;
    if (!oneShort) why.push("reps_differ");
  }
  const range = ESTIMATE_ROM_MM[movement.kind];
  const roms = a.reps.map((r) => r.top - r.bottom);
  if (!range) why.push("movement_unknown");
  else if (a.units !== "mm" || roms.some((r) => !(r >= range[0] && r <= range[1]))) why.push("range_implausible");
  if (roms.length) {
    const mid = median(roms);
    if (roms.some((r) => Math.abs(r - mid) > ESTIMATE_ROM_SPREAD * mid)) why.push("rom_inconsistent");
  }
  return [...new Set(why)];
}

/**
 * The plate's size for a candidate from its two measurements (pure). The two disagree on real stacks
 * both ways: what moves with the plate stops short of its rim (blur, shadow, a lit edge), its edges run
 * on into whatever is beside it (an upright, a lit wall). Measured by hand on Dwayne's front-on squats:
 * one set's stacks were 54 px through the set, read 53–55 by motion and 54 / 77 by their edges (the
 * edges ran on); another's were 60, read 43 by motion and 60 by its edges (motion stopped short). Either
 * can be the one that's right, so when the edges say more than 10 % bigger the size is their geometric
 * mean and its margin half the gap (in log terms: the truth can be at either end). A gap over ~27 % is
 * then past the scale gate (quality.ts TOLERANT 12 %) and the candidate isn't logged: never a size
 * picked from two that disagree. Edges smaller than motion found an inner step (motion is only ever
 * read short), and motion stands.
 */
export function plateSize(
  motion: { b: number; relB: number; pairs: number } | null,
  prof: Extent | null,
  seed: Pick<BoxSeed, "hw" | "hh">,
): { ext: Extent | null; blend: boolean } {
  const blend = !!motion && !!prof && prof.b > BLEND_FROM * motion.b;
  if (!motion) return { ext: prof, blend: false };
  const b = blend ? Math.sqrt(prof!.b * motion.b) : motion.b;
  return {
    blend,
    ext: {
      b,
      relB: blend ? Math.max(motion.relB, prof!.relB, Math.log(prof!.b / motion.b) / 2) : motion.relB,
      a: prof ? Math.min(prof.a, 1.4 * b) : seed.hw * (b / seed.hh),
      relA: prof?.relA ?? 0.1,
      frames: motion.pairs,
      faint: false,
    },
  };
}

/**
 * Whether candidates that each read the set disagree (pure): two whose speed ranges (EstimateTry.range)
 * are further apart than ESTIMATE_AGREE of their median. A blended candidate's range covers both of its
 * measurements, so a stack read short by one measurement never refuses one read right by the other, and
 * a scale truly off on one candidate (outside anything its own measurements allow) still does.
 */
export function candidatesDisagree(tried: Pick<EstimateTry, "accepted" | "range">[]): boolean {
  const rs = tried.filter((t) => t.accepted && t.range).map((t) => t.range!);
  if (rs.length < 2) return false;
  const mid = median(rs.map((r) => Math.sqrt(r.lo * r.hi)));
  if (!(mid > 0)) return false;
  for (let i = 0; i < rs.length; i++)
    for (let k = i + 1; k < rs.length; k++) {
      const gap = Math.max(0, rs[k].lo - rs[i].hi, rs[i].lo - rs[k].hi);
      if (gap / mid > ESTIMATE_AGREE) return true;
    }
  return false;
}

export function estimateRead(frames: Frame[], opts: EstimateOptions): EstimateResult {
  const tried: EstimateTry[] = [];
  if (frames.length < 10) return { ok: false, why: "no_candidates", tried, best: null };
  const samples = everyNth(frames, 6);
  // dark blobs, then the same with thin uprights taken out (a stack that passes a rack), then circles
  const wide = samples.length ? stackSeeds(samples, 2, Math.max(4, Math.round(0.055 * samples[0].w))) : [];
  const seeds = [...stackSeeds(samples, 3), ...wide, ...(opts.extraSeeds ?? [])];
  // the same place twice is one candidate
  const uniq: BoxSeed[] = [];
  for (const s of seeds)
    if (!uniq.some((u) => Math.abs(u.t - s.t) < 0.3 && Math.hypot(u.x - s.x, u.y - s.y) < 0.5 * Math.min(u.hh, s.hh)))
      uniq.push(s);
  const cands = uniq.slice(0, opts.maxCandidates ?? 8);
  if (!cands.length) return { ok: false, why: "no_candidates", tried, best: null };
  const plate = opts.plate ?? { ...DEFAULT_PLATE, confirmed: false };
  let best: { a: LiftAnalysis; score: number } | null = null;
  let bestAny: { a: LiftAnalysis; score: number } | null = null;
  cands.forEach((seed, ci) => {
    opts.onCandidate?.(ci, cands.length);
    const points = followBox(frames, seed);
    const found = points.filter((p) => p.found).length / Math.max(1, points.length);
    if (found < 0.4) {
      tried.push({ from: seed.from, reps: 0, complete: 0, tracked: found, accepted: false, value: null, why: ["plate_lost"] });
      return;
    }
    // the plate's height from what moves with it (any background); its width, and the height when that
    // can't be read, from its edges
    const motion = measureByMotion(frames, points, seed);
    const prof = measureExtent(frames, points, seed, opts.hiRes);
    const { ext, blend } = plateSize(motion, prof, seed);
    // edge-on: a stack front-on is clearly narrower than it is tall (a plate's face turned that far isn't read)
    const edgeOn = !!ext && (seed.from === "stack" || seed.from === "wide" ? ext.a / ext.b < 0.75 : ext.a / ext.b < 0.62);
    const pts = ext ? points.map((p) => (p.found ? { ...p, a: ext.a, b: ext.b, r: Math.sqrt(ext.a * ext.b) } : p)) : points;
    const a = analyzeTrack(pts, {
      plate,
      source: "auto",
      seed: { x: seed.x, y: seed.y, r: seed.hh, t: seed.t },
      frame: { w: frames[0].w, h: frames[0].h },
      dirHint: opts.dirHint,
      size: ext ? { ...ext, edgeOn } : null,
      movement: opts.movement,
      keys: [{ t: seed.t, x: seed.x, y: seed.y, a: seed.hw, b: seed.hh, source: "auto" }],
    });
    a.engine = ESTIMATE_ENGINE;
    a.movement = opts.movement;
    const why = plainlyTheSet(a, opts.movement, opts.expectedReps);
    const complete = a.reps.filter((r) => r.complete).length;
    const ok = !why.length;
    // speed ∝ 1 / plate height: undo the blend for the comparison between candidates
    const v = ok ? a.velocity.value : null;
    const range =
      v != null ? (blend && motion && prof ? { lo: (v * ext!.b) / prof.b, hi: (v * ext!.b) / motion.b } : { lo: v, hi: v }) : null;
    tried.push({ from: seed.from, reps: a.reps.length, complete, tracked: a.quality.tracked, accepted: ok, value: v, range, why });
    const exact = opts.expectedReps != null && complete === opts.expectedReps ? 1 : 0;
    const score = (ok ? 10 : 0) + exact * 2 + a.quality.tracked + (a.units === "mm" ? Math.max(0, 1 - a.calibration.relErr * 5) : 0);
    if (ok && (!best || score > best.score)) best = { a, score };
    if (!bestAny || score > bestAny.score) bestAny = { a, score };
  });
  const chosen = best as { a: LiftAnalysis; score: number } | null;
  if (!chosen) return { ok: false, why: "no_read", tried, best: (bestAny as { a: LiftAnalysis } | null)?.a ?? null };
  // two candidates that each read the set must agree, or neither is trusted (a scale off on one of them)
  if (candidatesDisagree(tried))
    return { ok: false, why: "disagree", tried, best: chosen.a };
  const a = chosen.a;
  // a read made this way is an estimate, whatever its margin
  const s = calibratedSetMean(a, opts.movement);
  a.velocity = { ...a.velocity, tier: "estimated", ...(s ? { value: s.value, uncertainty: s.uncertainty, plateCheck: s.plateCheck } : {}) };
  if (!a.quality.notes.includes("estimated_track")) a.quality.notes.push("estimated_track");
  return { ok: true, analysis: a, tried };
}
