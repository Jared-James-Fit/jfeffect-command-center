/**
 * Synthetic lifting clips with a known answer, for validating the lift
 * analysis engine: a loaded barbell's plate moving along a trajectory we
 * wrote down (so its true velocity at every instant is known), rendered the
 * way a phone sees it: a gym background with edges and clutter, plates
 * sitting on a tree (round, the same size, never moving), the lifter's body
 * moving with the bar, motion blur over the exposure, sensor noise, exposure
 * flicker, optionally a camera that isn't side-on (the plate an ellipse),
 * someone walking in front, a handheld camera, and variable frame timing.
 */
import type { Frame } from "@/lib/lift-analysis/image";

export type Phase =
  | { kind: "hold"; dur: number }
  | { kind: "down"; rom: number; dur: number }
  | { kind: "up"; rom: number; dur: number; dip?: number; dipAt?: number; gradual?: boolean };

export type Scene = {
  w: number;
  h: number;
  fps: number;
  /** Plate diameter in pixels (vertical axis). */
  plateDiameterPx: number;
  plateMm?: number;
  /** Where the bar starts (px) and whether y = 0 mm is the top (squat/bench) or the floor (deadlift). */
  x0: number;
  y0: number;
  phases: Phase[];
  /** Horizontal drift (mm) as a function of height fraction 0…1 within the rep (a J-curve, a bar drifting forward). */
  drift?: (fraction: number, up: boolean) => number;
  /** Plate seen this far off side-on: its horizontal axis is cos(yaw) of its vertical one. */
  yawDeg?: number;
  /** Camera tilted up or down: vertical distances (the plate's too) look cos(pitch) shorter. */
  pitchDeg?: number;
  /** Leave the plate out (nothing to find). */
  noPlate?: boolean;
  noise?: number;
  /** Exposure time (s) for motion blur. */
  exposure?: number;
  staticPlates?: { x: number; y: number }[];
  /** Someone crossing in front of the plate between these times. */
  walker?: { t0: number; t1: number };
  /** Handheld: the whole picture shifts by up to this many pixels. */
  shake?: number;
  /** Frame-time jitter as a share of a frame. */
  jitter?: number;
  seed?: number;
};

export type Truth = {
  /** 1 kHz samples: time, vertical mm (up), horizontal mm. */
  t: Float64Array;
  y: Float64Array;
  x: Float64Array;
  v: Float64Array;
  /** Concentric phases (from the scene), with their true MCV / peak by the engine's own boundary rule. */
  reps: {
    start: number;
    end: number;
    rom: number;
    mcv: number;
    peak: number;
    stickingFraction: number | null;
  }[];
  mmPerPx: number;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** A concentric velocity shape on 0…1: a bell, with an optional dip (the sticking region). */
function upShape(tau: number, dip: number, dipAt: number, gradual = false): number {
  // abrupt: force on fast out of a pause; gradual: force builds over ~a tenth of the rep (jerk-limited)
  const sp = Math.sin(Math.PI * tau);
  const base = gradual ? sp ** 1.6 + 0.25 * sp * sp * (1 - tau) : sp ** 0.8 + 0.25 * sp * (1 - tau);
  const bump = dip * Math.exp(-((tau - dipAt) ** 2) / (2 * 0.07 ** 2));
  return Math.max(0, base * (1 - bump));
}

/** The trajectory, sampled at 1 kHz, and the true per-rep numbers. */
export function trajectory(scene: Scene): Truth {
  const dt = 0.001;
  const total = scene.phases.reduce((s, p) => s + p.dur, 0);
  const n = Math.ceil(total / dt) + 1;
  const t = new Float64Array(n);
  const y = new Float64Array(n);
  const v = new Float64Array(n);
  const x = new Float64Array(n);
  let pos = 0;
  let i = 0;
  let now = 0;
  const reps: Truth["reps"] = [];
  let lo = 0;
  let hi = 0;
  for (const ph of scene.phases) {
    const steps = Math.round(ph.dur / dt);
    if (ph.kind === "hold") {
      for (let k = 0; k < steps; k++, i++) {
        t[i] = now + k * dt;
        y[i] = pos;
        v[i] = 0;
      }
    } else if (ph.kind === "down") {
      const startPos = pos;
      for (let k = 0; k < steps; k++, i++) {
        const tau = k / steps;
        t[i] = now + k * dt;
        y[i] = startPos - (ph.rom * (1 - Math.cos(Math.PI * tau))) / 2;
        v[i] = (-ph.rom * Math.PI * Math.sin(Math.PI * tau)) / (2 * ph.dur);
      }
      pos = startPos - ph.rom;
    } else {
      // integrate the shape, then scale so it rises exactly rom in dur
      const shape = new Float64Array(steps);
      let area = 0;
      for (let k = 0; k < steps; k++) {
        shape[k] = upShape((k + 0.5) / steps, ph.dip ?? 0, ph.dipAt ?? 0.4, ph.gradual);
        area += shape[k] * dt;
      }
      const scale = ph.rom / area;
      const startPos = pos;
      let acc = 0;
      for (let k = 0; k < steps; k++, i++) {
        t[i] = now + k * dt;
        v[i] = shape[k] * scale;
        y[i] = startPos + acc;
        acc += shape[k] * scale * dt;
      }
      pos = startPos + ph.rom;
    }
    now += steps * dt;
  }
  for (; i < n; i++) {
    t[i] = now;
    y[i] = pos;
    v[i] = 0;
    now += dt;
  }
  // horizontal: a function of where the bar is within the rep's range
  for (let k = 0; k < n; k++) {
    lo = Math.min(lo, y[k]);
    hi = Math.max(hi, y[k]);
  }
  for (let k = 0; k < n; k++) {
    const frac = hi > lo ? (y[k] - lo) / (hi - lo) : 0;
    x[k] = scene.drift ? scene.drift(frac, v[k] >= 0) : 0;
  }
  // the true numbers, by the engine's boundary rule (moving up faster than 30 mm/s)
  let k = 0;
  while (k < n) {
    if (v[k] > 30) {
      const s = k;
      let peak = 0;
      while (k < n && v[k] > 30) {
        peak = Math.max(peak, v[k]);
        k++;
      }
      const e = k - 1;
      const rom = y[e] - y[s];
      if (rom > 50) {
        // sticking region: first velocity peak, then the slowest point after it before the second rise
        let stick: number | null = null;
        let firstPeak = -1;
        for (let j = s + 1; j < e - 1; j++) {
          if (v[j] >= v[j - 1] && v[j] > v[j + 1]) {
            firstPeak = j;
            break;
          }
        }
        if (firstPeak > 0) {
          let minJ = firstPeak;
          for (let j = firstPeak; j < e; j++) {
            if (v[j] < v[minJ]) minJ = j;
            if (v[j] > v[minJ] * 1.12 && v[minJ] < v[firstPeak] * 0.92) {
              stick = (y[minJ] - y[s]) / rom;
              break;
            }
          }
        }
        reps.push({
          start: t[s],
          end: t[e],
          rom,
          mcv: rom / (t[e] - t[s]),
          peak,
          stickingFraction: stick,
        });
      }
    }
    k++;
  }
  return { t, y, x, v, reps, mmPerPx: (scene.plateMm ?? 450) / scene.plateDiameterPx };
}

function interp(arr: Float64Array, t: Float64Array, at: number): number {
  const dt = t[1] - t[0];
  const f = Math.max(0, Math.min(arr.length - 1, (at - t[0]) / dt));
  const i = Math.floor(f);
  const j = Math.min(arr.length - 1, i + 1);
  return arr[i] + (arr[j] - arr[i]) * (f - i);
}

type Background = Float32Array;

function background(scene: Scene, rand: () => number): Background {
  const { w, h } = scene;
  const bg = new Float32Array(w * h);
  const floorY = Math.round(h * 0.82);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = y < floorY ? 165 - 25 * (y / h) : 85 + 10 * Math.sin(x / 9);
      // a wall texture: soft stripes and a few posters
      v += 6 * Math.sin(x / 23 + y / 41) + 4 * Math.sin(y / 7.3);
      bg[y * w + x] = v;
    }
  }
  // the rack's uprights and a mirror edge: strong straight edges
  const posts = [Math.round(w * 0.12), Math.round(w * 0.88)];
  for (const px of posts) {
    for (let y = Math.round(h * 0.1); y < floorY; y++)
      for (let x = px - 4; x <= px + 4; x++) if (x >= 0 && x < w) bg[y * w + x] = 55;
  }
  for (let k = 0; k < 4; k++) {
    const rx = Math.round(rand() * w * 0.8);
    const ry = Math.round(rand() * h * 0.5);
    const rw = 10 + Math.round(rand() * 30);
    const rh = 10 + Math.round(rand() * 40);
    const val = 60 + rand() * 150;
    for (let y = ry; y < Math.min(h, ry + rh); y++)
      for (let x = rx; x < Math.min(w, rx + rw); x++) bg[y * w + x] = val;
  }
  return bg;
}

/** Draw a plate (antialiased, as an ellipse with semi-axes R·q × R) by alpha-blending into `img`. */
function drawPlate(
  img: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  R: number,
  q: number,
  alpha: number,
  qy = 1,
) {
  const x0 = Math.max(0, Math.floor(cx - R - 2));
  const x1 = Math.min(w - 1, Math.ceil(cx + R + 2));
  const y0 = Math.max(0, Math.floor(cy - R - 2));
  const y1 = Math.min(h - 1, Math.ceil(cy + R + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // 2 × 2 supersampling for the edge
      let acc = 0;
      let cov = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const dx = (x + 0.25 + sx * 0.5 - cx) / q;
          const dy = (y + 0.25 + sy * 0.5 - cy) / qy;
          const d = Math.hypot(dx, dy);
          if (d > R) continue;
          cov += 0.25;
          const f = d / R;
          let val = 38;
          if (f > 0.86 && f < 0.94) val = 58; // the plate's raised lip
          if (f < 0.24) val = 140; // the hub
          if (f < 0.1) val = 205; // the sleeve's end
          acc += 0.25 * val;
        }
      }
      if (!cov) continue;
      const i = y * w + x;
      const a = alpha * cov;
      img[i] = img[i] * (1 - a) + (acc / cov) * a;
    }
  }
}

function drawEllipse(
  img: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  val: number,
) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(h - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(w - 1, Math.ceil(cx + rx)); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) img[y * w + x] = val;
    }
  }
}

export type Clip = { frames: Frame[]; truth: Truth; scene: Scene };

/** Render the clip. */
export function renderClip(scene: Scene): Clip {
  const truth = trajectory(scene);
  const rand = rng(scene.seed ?? 7);
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const { w, h } = scene;
  const bg = background(scene, rand);
  const noiseTable = new Float32Array(w * h * 3);
  for (let i = 0; i < noiseTable.length; i++) noiseTable[i] = gauss();
  const R = scene.plateDiameterPx / 2;
  const q = Math.cos(((scene.yawDeg ?? 0) * Math.PI) / 180);
  const qy = Math.cos(((scene.pitchDeg ?? 0) * Math.PI) / 180);
  const duration = truth.t[truth.t.length - 1];
  const frames: Frame[] = [];
  const exposure = scene.exposure ?? 1 / 120;
  const noise = scene.noise ?? 4;
  const jitter = scene.jitter ?? 0;
  for (let k = 0; ; k++) {
    let t = k / scene.fps + (jitter ? ((rand() - 0.5) * jitter) / scene.fps : 0);
    if (k === 0) t = 0;
    if (t > duration - exposure) break;
    const gain = 1 + 0.02 * Math.sin(k * 0.7);
    const shakeX = scene.shake ? scene.shake * Math.sin(k * 0.9) : 0;
    const shakeY = scene.shake ? scene.shake * Math.cos(k * 1.3) : 0;
    // a handheld camera moves the whole picture (whole pixels here: enough to see)
    let img: Float32Array;
    if (scene.shake) {
      img = new Float32Array(w * h);
      const ox = Math.round(shakeX);
      const oy = Math.round(shakeY);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          img[y * w + x] =
            bg[Math.min(h - 1, Math.max(0, y - oy)) * w + Math.min(w - 1, Math.max(0, x - ox))];
    } else img = new Float32Array(bg);
    for (const sp of scene.staticPlates ?? [])
      drawPlate(img, w, h, sp.x + shakeX, sp.y + shakeY, R, 1, 1);
    // the lifter: a body behind the bar, moving with it
    const ymm = interp(truth.y, truth.t, t);
    const xmm = interp(truth.x, truth.t, t);
    const bx = scene.x0 + (xmm / truth.mmPerPx) * q + shakeX;
    const by = scene.y0 - (ymm / truth.mmPerPx) * qy + shakeY;
    drawEllipse(img, w, h, bx - R * 0.6, by + R * 1.1, R * 0.9, R * 1.6, 95);
    drawEllipse(img, w, h, bx - R * 0.5, by - R * 1.1, R * 0.45, R * 0.5, 120);
    // the plate, blurred over the exposure
    const sub = 4;
    for (let s = 0; s < sub; s++) {
      const ts = t + (exposure * (s + 0.5)) / sub;
      if (scene.noPlate) break;
      const sy = scene.y0 - (interp(truth.y, truth.t, ts) / truth.mmPerPx) * qy + shakeY;
      const sx = scene.x0 + (interp(truth.x, truth.t, ts) / truth.mmPerPx) * q + shakeX;
      drawPlate(img, w, h, sx, sy, R, q, s === 0 ? 1 : 1 / (s + 1), qy);
    }
    if (scene.walker && t >= scene.walker.t0 && t <= scene.walker.t1) {
      const f = (t - scene.walker.t0) / (scene.walker.t1 - scene.walker.t0);
      drawEllipse(img, w, h, -1.6 * R + f * (w + 3.2 * R), scene.y0, R * 1.5, R * 3, 70);
    }
    const px = new Uint8Array(w * h);
    // sensor noise from a pre-drawn table at a random offset (drawing it per pixel is slow)
    const off = Math.floor(rand() * (noiseTable.length - w * h - 1));
    for (let i = 0; i < w * h; i++)
      px[i] = Math.max(0, Math.min(255, Math.round(img[i] * gain + noise * noiseTable[off + i])));
    frames.push({ w, h, px, t });
  }
  return { frames, truth, scene };
}

/** A squat-like set: hold at the top, then reps of down / pause / up, then hold. */
/** A deadlift-like set: bar on the floor, pull, hold at lockout, lower, rest. */
export function deadliftSet(opts: {
  reps: number;
  rom: number;
  up: number;
  down: number;
  slowdown?: number;
  dip?: number;
}): Phase[] {
  const out: Phase[] = [{ kind: "hold", dur: 1 }];
  for (let r = 0; r < opts.reps; r++) {
    out.push({
      kind: "up",
      rom: opts.rom,
      dur: opts.up * (1 + (opts.slowdown ?? 0) * r),
      dip: opts.dip ?? 0,
      dipAt: 0.55,
      gradual: true,
    });
    out.push({ kind: "hold", dur: 0.5 });
    out.push({ kind: "down", rom: opts.rom, dur: opts.down });
    out.push({ kind: "hold", dur: 0.7 });
  }
  return out;
}

export function squatSet(opts: {
  reps: number;
  rom: number;
  down: number;
  up: number;
  slowdown?: number;
  dip?: number;
  pause?: number;
  gradual?: boolean;
  touchAndGo?: boolean;
}): Phase[] {
  const out: Phase[] = [{ kind: "hold", dur: 0.8 }];
  for (let r = 0; r < opts.reps; r++) {
    out.push({ kind: "down", rom: opts.rom, dur: opts.down });
    if (opts.pause) out.push({ kind: "hold", dur: opts.pause });
    else if (!opts.touchAndGo) out.push({ kind: "hold", dur: 0.05 });
    out.push({
      kind: "up",
      rom: opts.rom,
      dur: opts.up * (1 + (opts.slowdown ?? 0) * r),
      dip: opts.dip ?? 0,
      dipAt: 0.38,
      gradual: opts.gradual,
    });
    out.push({ kind: "hold", dur: 0.6 });
  }
  out.push({ kind: "hold", dur: 0.6 });
  return out;
}
