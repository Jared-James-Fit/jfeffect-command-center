/**
 * Realistic test footage for the lift analysis engine (validation only, never
 * the app): a set filmed the way athletes film it, rendered in colour with a
 * known answer, then encoded to H.264 by ffmpeg at the bitrate the app sends
 * set videos at, so it goes through the same decoder, compression and
 * downscale as a real clip.
 *
 * What makes real footage hard, and is here on purpose:
 *   - black iron or bumper plates against a dim gym, a black rack and a black
 *     bench (the rim's contrast comes and goes);
 *   - the stack: smaller plates in front of the big one (rings inside it);
 *   - the plate on the far end of the bar when the phone isn't straight on
 *     (smaller, offset, moving with the bar: the decoy that looks most alike);
 *   - identical plates on a tree and on a second bar in the background;
 *   - the lifter's head and body moving behind the plate;
 *   - the floor under a deadlift's plates, a bottle in front of the plate,
 *     someone walking past the camera;
 *   - motion blur over a 1/30 s or 1/60 s exposure, sensor noise, flicker, a
 *     handheld camera, a phone turned or tilted off side-on.
 *
 * The bar's trajectory comes from the synthetic suite (trajectory()), so the
 * true velocity is known at every instant.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { trajectory, interp, type Phase, type Truth } from "../../src/test/lift-analysis/synthetic";

export type Lift = "squat" | "bench" | "deadlift" | "sumo";
export type PlateStyle = "iron" | "iron-dark" | "bumper" | "comp";

export type GymScene = {
  name: string;
  lift: Lift;
  phases: Phase[];
  w?: number;
  h?: number;
  fps: number;
  /** Exposure (s): a dim gym is 1/30 at 30 fps; 1/60 or shorter at 60. */
  exposure?: number;
  /** The biggest plate's size (mm) and how big it is in the picture (diameter, px). */
  plateMm?: number;
  plateDiameterPx?: number;
  style?: PlateStyle;
  /** Phone turned (yaw) or tilted (pitch) off straight at the end of the bar. */
  yawDeg?: number;
  pitchDeg?: number;
  /**
   * How thick the plates on the near sleeve are (mm, the whole stack): a
   * turned phone sees their edge as a band beside the face, as a real plate
   * does (cast iron ~40 mm a plate, bumpers ~65). Default 90.
   */
  stackMm?: number;
  /**
   * The far end's plate in view (the phone not straight on): offset from the
   * near plate by (dx, dy) of its radius, `scale` of its size, moving by
   * `scale` of the bar's travel. `true`: a mild offset.
   */
  farPlate?: boolean | { dx: number; dy: number; scale: number };
  /** The bar taken out of the hooks before the set and put back after: this far sideways (mm). */
  rackMove?: number;
  /** A rack upright right behind the plate where the bar sits in the hooks (black on black). */
  uprightBehind?: boolean;
  /** Auto-exposure drifting by up to this share (the phone re-metering as the lifter moves). */
  aeDrift?: number;
  /** A black wall or curtain behind the bar (little contrast at the plate's rim). */
  darkBack?: boolean;
  /** Someone walking past the camera between these times. */
  walker?: { t0: number; t1: number };
  /** Something in front of the lower part of the plate when the bar is low (a bottle, a chalk bowl). */
  bottle?: boolean;
  /** Handheld: the picture moves by up to this many px. */
  shake?: number;
  /** Overall brightness (1 = a well lit gym, 0.6 = dim). */
  light?: number;
  noise?: number;
  /** H.264 bitrate (the app's transcode is ~2.3–3 Mbps at 720p). */
  bitrate?: string;
  seed?: number;
  /** Phone clocks: frame times jitter by this share of a frame. */
  jitter?: number;
};

type RGB = [number, number, number];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** A canvas of float RGB, drawn into with coverage (alpha). */
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.r = new Float32Array(w * h);
    this.g = new Float32Array(w * h);
    this.b = new Float32Array(w * h);
  }
  copyFrom(o: Canvas, dx = 0, dy = 0) {
    if (!dx && !dy) {
      this.r.set(o.r);
      this.g.set(o.g);
      this.b.set(o.b);
      return;
    }
    const { w, h } = this;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(h - 1, Math.max(0, y - dy));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(w - 1, Math.max(0, x - dx));
        const i = y * w + x;
        const j = sy * w + sx;
        this.r[i] = o.r[j];
        this.g[i] = o.g[j];
        this.b[i] = o.b[j];
      }
    }
  }
  blend(i: number, c: RGB, a: number) {
    this.r[i] += (c[0] - this.r[i]) * a;
    this.g[i] += (c[1] - this.g[i]) * a;
    this.b[i] += (c[2] - this.b[i]) * a;
  }
  /** Fill a shape given by an inside test (2×2 supersampled edges). */
  fill(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    inside: (x: number, y: number) => boolean,
    color: RGB | ((x: number, y: number) => RGB),
  ) {
    const xa = Math.max(0, Math.floor(x0));
    const xb = Math.min(this.w - 1, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0));
    const yb = Math.min(this.h - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        let cov = 0;
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++)
            if (inside(x + 0.25 + 0.5 * sx, y + 0.25 + 0.5 * sy)) cov++;
        if (!cov) continue;
        const c = typeof color === "function" ? color(x + 0.5, y + 0.5) : color;
        this.blend(y * this.w + x, c, cov / 4);
      }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: RGB, rot = 0) {
    const R = Math.max(rx, ry);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    this.fill(
      cx - R,
      cy - R,
      cx + R,
      cy + R,
      (x, y) => {
        const u = (x - cx) * c + (y - cy) * s;
        const v = -(x - cx) * s + (y - cy) * c;
        return (u / rx) ** 2 + (v / ry) ** 2 <= 1;
      },
      color,
    );
  }
  rect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: RGB | ((x: number, y: number) => RGB),
  ) {
    this.fill(x0, y0, x1, y1, (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, color);
  }
  /** A thick segment (a limb), rounded ends. */
  limb(ax: number, ay: number, bx: number, by: number, width: number, color: RGB) {
    const hw = width / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    this.fill(
      Math.min(ax, bx) - hw,
      Math.min(ay, by) - hw,
      Math.max(ax, bx) + hw,
      Math.max(ay, by) + hw,
      (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= hw;
      },
      color,
    );
  }
}

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** The plate stack's face at (u, v) from its centre, in units of its radius (u right, v down). */
/** The plates' rolled edge seen from the side: darker than the face, a sheen along the top. */
function plateEdge(style: PlateStyle, v: number, light: number): RGB {
  const k = light * (1 + 0.25 * -v);
  if (style === "comp") return shade([110, 22, 26], k);
  if (style === "bumper") return shade([24, 24, 26], k);
  return shade([30, 30, 32], k * (1 + 0.15 * Math.cos(v * 9)));
}

function plateColor(style: PlateStyle, u: number, v: number, spin: number, light: number): RGB {
  const d = Math.hypot(u, v);
  const th = Math.atan2(v, u) + spin;
  // lit from above: the top of the plate a little brighter
  const k = light * (1 + 0.18 * -v);
  let c: RGB;
  if (style === "iron" || style === "iron-dark") {
    c = [38, 38, 40];
    if (d > 0.9)
      c = [52, 52, 55]; // the rim's lip
    else if (d > 0.62 && d < 0.82 && Math.cos(9 * th) > 0.55)
      c = [70, 70, 72]; // raised lettering
    else if (d < 0.7 && d > 0.66) c = [24, 24, 26];
    // a 25 lb plate in front: its own rim
    if (d < 0.6 && d > 0.56) c = [60, 60, 62];
  } else if (style === "bumper") {
    c = [32, 32, 34];
    if (d > 0.95) c = [26, 26, 28];
    else if (d > 0.5 && d < 0.56 && Math.cos(3 * th) > 0.2) c = [190, 190, 190]; // white lettering
    // a steel insert ring
    if (d < 0.3 && d > 0.24) c = [120, 120, 125];
  } else {
    // competition: a red 25 kg (450), a blue 20 kg in front (450, a thinner rim line), a green 10 kg (325)
    c = [170, 30, 34];
    if (d > 0.97) c = [120, 20, 24];
    if (d < 0.72) c = [40, 110, 60]; // the 10 kg
    if (d < 0.72 && d > 0.69) c = [25, 70, 40];
    if (d > 0.4 && d < 0.5 && Math.cos(5 * th) > 0.4) c = [230, 230, 230];
  }
  // the hub, the sleeve and its end (or a black collar over it)
  if (style === "iron-dark") {
    if (d < 0.26) c = [30, 30, 33];
    if (d < 0.26 && d > 0.22) c = [44, 44, 46];
    if (d < 0.07) c = [96, 96, 100];
    return shade(c, k);
  }
  if (d < 0.24) c = [150, 150, 155];
  if (d < 0.2) c = [120, 120, 126];
  if (d < 0.11) c = [205, 205, 210];
  return shade(c, k);
}

export type Rendered = {
  truth: Truth;
  frames: number;
  file: string;
  scene: GymScene;
  mmPerPx: number;
};

/**
 * Render a scene and encode it to `file` (MP4, H.264, yuv420p). Writes the
 * truth beside it (`file`.json): every rep's concentric start / end, range,
 * MCV and peak, the plate's size in the picture, and the trajectory at the
 * frame times (y up, mm).
 */
/** Where everything is: the trajectory, the plate's size and position in the picture at any moment. */
export function sceneGeometry(scene: GymScene) {
  const W = scene.w ?? 720;
  const H = scene.h ?? 1280;
  const D = scene.plateDiameterPx ?? 150;
  const plateMm = scene.plateMm ?? 450;
  const mmPerPx = plateMm / D;
  const R = D / 2;
  // the trajectory, scaled to the picture
  const truth = trajectory({
    w: W,
    h: H,
    fps: scene.fps,
    plateDiameterPx: D,
    plateMm,
    x0: 0,
    y0: 0,
    phases: scene.phases,
    drift: (f, up) =>
      scene.lift === "bench"
        ? (up ? -60 : -45) * (1 - f) // a J-curve toward the face at the top
        : scene.lift === "squat"
          ? 12 * Math.sin(Math.PI * f)
          : -8 * f,
  });
  // out of the hooks (first 0.8 s) and back in (the last 0.8 s): sideways, and a lift of 40 mm off the hooks
  const total = truth.t[truth.t.length - 1];
  const move = scene.rackMove ?? 0;
  const ease = (f: number) => (f <= 0 ? 0 : f >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * f));
  const rackX = (t: number) =>
    move ? move * (1 - ease(t / 0.8)) + move * ease((t - (total - 0.9)) / 0.8) : 0;
  const rackLift = (t: number) =>
    move ? -40 * (1 - ease((t - 0.1) / 0.3)) - 40 * ease((t - (total - 0.4)) / 0.3) : 0;
  const yawQ = Math.cos(((scene.yawDeg ?? 0) * Math.PI) / 180);
  const pitchQ = Math.cos(((scene.pitchDeg ?? 0) * Math.PI) / 180);
  const floorY = Math.round(H * 0.9);
  const barX = Math.round(W * 0.5);
  // the bar's height above the floor at the start of the clip (mm)
  const startMm = scene.lift === "squat" ? 1450 : scene.lift === "bench" ? 1150 : plateMm / 2;
  const toPx = (xmm: number, ymm: number): [number, number] => [
    barX + (xmm / mmPerPx) * yawQ,
    floorY - ((startMm + ymm) / mmPerPx) * pitchQ,
  ];
  const posAt = (t: number) => ({
    ymm: interp(truth.y, truth.t, t) + rackLift(t),
    xmm: interp(truth.x, truth.t, t) + rackX(t),
  });
  const exposure = scene.exposure ?? 1 / scene.fps;
  /** The plate's centre (px) in a frame taken at t (the middle of its exposure). */
  const centerAt = (t: number): [number, number] => {
    const p = posAt(t + exposure / 2);
    return toPx(p.xmm, p.ymm);
  };
  return {
    W,
    H,
    D,
    R,
    plateMm,
    mmPerPx,
    truth,
    yawQ,
    pitchQ,
    floorY,
    barX,
    toPx,
    posAt,
    centerAt,
    exposure,
    axes: [R * yawQ, R * pitchQ] as const,
  };
}

export async function renderGymClip(scene: GymScene, file: string): Promise<Rendered> {
  const { W, H, R, mmPerPx, truth, yawQ, pitchQ, floorY, barX, toPx, posAt } = sceneGeometry(scene);
  const style = scene.style ?? "iron";
  const light = scene.light ?? 0.85;
  const rand = rng(scene.seed ?? 11);
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  // ── the gym, once ──
  const bg = new Canvas(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let c: RGB;
      if (y < floorY) {
        // a warm grey wall, darker low down, a wall light's glow, faint panels
        const glow =
          30 * Math.exp(-(((x - W * 0.75) / (W * 0.4)) ** 2) - ((y - H * 0.1) / (H * 0.3)) ** 2);
        const base = 112 - 30 * (y / floorY) + glow + 5 * Math.sin(x / 41) * Math.sin(y / 67);
        c = [base * 1.04, base, base * 0.92];
        if (Math.abs((x % 240) - 120) < 1.5) c = shade(c, 0.85);
      } else {
        const base = 44 + 6 * Math.sin(x / 13) * Math.sin(y / 5);
        c = [base, base, base * 1.05];
        if (Math.abs(((x + 3 * (y - floorY)) % 300) - 150) < 1.2) c = shade(c, 0.7);
      }
      bg.r[i] = c[0] * light;
      bg.g[i] = c[1] * light;
      bg.b[i] = c[2] * light;
    }
  // a mirror strip and posters
  bg.rect(W * 0.02, H * 0.18, W * 0.3, H * 0.55, (x, y) =>
    shade([150, 155, 160], light * (0.8 + 0.2 * Math.sin(y / 30))),
  );
  bg.rect(W * 0.62, H * 0.12, W * 0.8, H * 0.25, shade([150, 40, 40], light));
  bg.rect(W * 0.82, H * 0.3, W * 0.97, H * 0.4, shade([40, 70, 140], light));
  // the rack's uprights (black, with holes), either side of the bar, and the safety arms
  const rackHalf = 520 / mmPerPx;
  const upW = 75 / mmPerPx;
  for (const ux of [barX - rackHalf, barX + rackHalf]) {
    bg.rect(ux - upW / 2, H * 0.05, ux + upW / 2, floorY, shade([34, 34, 36], light));
    for (let yy = H * 0.07; yy < floorY - 20; yy += 50 / mmPerPx)
      bg.ellipse(ux, yy, 0.18 * upW, 0.18 * upW, shade([90, 90, 92], light));
  }
  if (scene.lift !== "deadlift" && scene.lift !== "sumo") {
    const safetyY = floorY - (scene.lift === "bench" ? 560 : 900) / mmPerPx;
    bg.rect(
      barX - rackHalf - upW,
      safetyY - 12,
      barX + rackHalf + upW,
      safetyY + 12,
      shade([46, 46, 48], light),
    );
  }
  if (scene.darkBack) {
    bg.rect(barX - 3.2 * R, H * 0.08, barX + 3.2 * R, floorY, (x, y) =>
      shade([34, 33, 35], light * (0.9 + 0.1 * Math.sin(x / 17))),
    );
  }
  if (scene.uprightBehind) {
    // the bar sits in the hooks with the plate right in front of the upright
    const [hx, hy] = toPx(scene.rackMove ?? 0, -40);
    bg.rect(
      hx + 0.15 * R - upW / 2,
      H * 0.05,
      hx + 0.15 * R + upW / 2,
      floorY,
      shade([30, 30, 32], light),
    );
    for (let yy = H * 0.07; yy < floorY - 20; yy += 50 / mmPerPx)
      bg.ellipse(hx + 0.15 * R, yy, 0.18 * upW, 0.18 * upW, shade([80, 80, 82], light));
    // the J-hook under the bar
    bg.rect(hx - 0.6 * R, hy + 0.35 * R, hx + 0.6 * R, hy + 0.55 * R, shade([26, 26, 28], light));
  }
  if (scene.lift === "bench") {
    // the bench: pad and legs, black
    const padY = floorY - 430 / mmPerPx;
    bg.rect(
      barX - 900 / mmPerPx,
      padY - 70 / mmPerPx,
      barX + 350 / mmPerPx,
      padY,
      shade([28, 28, 30], light),
    );
    bg.rect(barX - 750 / mmPerPx, padY, barX - 700 / mmPerPx, floorY, shade([40, 40, 42], light));
    bg.rect(barX + 200 / mmPerPx, padY, barX + 250 / mmPerPx, floorY, shade([40, 40, 42], light));
  }
  // identical plates: a tree to one side, a second bar on a rack in the back
  const staticPlates: [number, number, number][] = [
    [W * 0.88, floorY - 1.05 * R, R],
    [W * 0.88, floorY - 2.15 * R, R * 0.92],
    [W * 0.12, H * 0.3, R * 0.62],
  ];
  for (const [sx, sy, sr] of staticPlates)
    bg.fill(
      sx - sr,
      sy - sr,
      sx + sr,
      sy + sr,
      (x, y) => Math.hypot(x - sx, y - sy) <= sr,
      (x, y) => plateColor(style, (x - sx) / sr, (y - sy) / sr, 0.7, light),
    );

  // ── every frame ──
  const duration = truth.t[truth.t.length - 1];
  const exposure = scene.exposure ?? 1 / scene.fps;
  const noise = scene.noise ?? 3.5;
  const jitter = scene.jitter ?? 0;
  const fr = new Canvas(W, H);
  const args = [
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${W}x${H}`,
    "-r",
    String(scene.fps),
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-b:v",
    scene.bitrate ?? "2.5M",
    "-maxrate",
    "3.5M",
    "-bufsize",
    "6M",
    "-g",
    String(Math.round(scene.fps * 2)),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    file,
  ];
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((res, rej) => {
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}`))));
    ff.on("error", rej);
  });
  const buf = Buffer.alloc(W * H * 3);
  // sensor noise from a pre-drawn table at a random offset (drawing it per pixel is slow)
  const noiseTable = new Float32Array(W * H + 65536);
  for (let i = 0; i < noiseTable.length; i++) noiseTable[i] = gauss();
  const frameTimes: number[] = [];
  let k = 0;
  for (; ; k++) {
    const t = k / scene.fps + (jitter && k ? ((rand() - 0.5) * jitter) / scene.fps : 0);
    if (t > duration - exposure) break;
    frameTimes.push(t);
    const sx = scene.shake
      ? Math.round(scene.shake * Math.sin(k * 0.37) + 0.5 * scene.shake * Math.sin(k * 1.9))
      : 0;
    const sy = scene.shake
      ? Math.round(scene.shake * Math.cos(k * 0.29) + 0.5 * scene.shake * Math.cos(k * 1.3))
      : 0;
    fr.copyFrom(bg, sx, sy);
    const { ymm, xmm } = posAt(t + exposure / 2);
    const [bx0, by0] = toPx(xmm, ymm);
    const bx = bx0 + sx;
    const by = by0 + sy;
    drawLifter(fr, scene.lift, bx, by, floorY + sy, mmPerPx, light, ymm, truth);
    // the far end's plate (behind the lifter's legs and body only partly)
    if (scene.farPlate) {
      const fp = scene.farPlate === true ? { dx: 1.3, dy: -0.8, scale: 0.56 } : scene.farPlate;
      const fq = fp.scale;
      // it moves by `scale` of the near plate's travel, about where the near plate started
      const [sx0, sy0] = toPx(0, 0);
      const fx = sx0 + fp.dx * R + (bx - sx0) * fq;
      const fy = sy0 + fp.dy * R + (by - sy0) * fq;
      const fR = R * fq;
      fr.fill(
        fx - fR,
        fy - fR,
        fx + fR,
        fy + fR,
        (x, y) => Math.hypot((x - fx) / yawQ, y - fy) <= fR,
        (x, y) => plateColor(style, (x - fx) / (fR * yawQ), (y - fy) / fR, 1.3, light * 0.9),
      );
    }
    // the plate, blurred over the exposure: coverage and colour averaged over sub-moments
    // the stack's edge: a turned phone sees it beside the face, away from the lifter
    const band =
      ((scene.stackMm ?? 90) / mmPerPx) * Math.sin(((scene.yawDeg ?? 0) * Math.PI) / 180);
    drawPlate(fr, posAt, toPx, t, exposure, R, yawQ, pitchQ, style, light, sx, sy, band);
    if (scene.bottle) {
      // a bottle near the camera, in front of the plate's lower part when the bar is low
      const [px0] = toPx(0, 0);
      const bTop = floorY - 420 / mmPerPx;
      fr.rect(px0 - 0.35 * R, bTop, px0 + 0.35 * R, floorY + 40, (x, y) =>
        shade([60, 120, 180], light * (0.8 + 0.25 * Math.sin((x - px0) / 9))),
      );
    }
    if (scene.walker && t >= scene.walker.t0 && t <= scene.walker.t1) {
      const f = (t - scene.walker.t0) / (scene.walker.t1 - scene.walker.t0);
      const wx = -2.5 * R + f * (W + 5 * R);
      fr.ellipse(wx, H * 0.55, 2.2 * R, H * 0.5, shade([70, 60, 55], light));
    }
    const gain =
      1 + 0.015 * Math.sin(k * 0.9) + (scene.aeDrift ?? 0) * Math.sin((2 * Math.PI * t) / 7 + 0.5);
    const off = Math.floor(rand() * 65000);
    for (let i = 0, j = 0; i < W * H; i++, j += 3) {
      const n = noise * noiseTable[off + i];
      buf[j] = Math.max(0, Math.min(255, Math.round(fr.r[i] * gain + n)));
      buf[j + 1] = Math.max(0, Math.min(255, Math.round(fr.g[i] * gain + n)));
      buf[j + 2] = Math.max(0, Math.min(255, Math.round(fr.b[i] * gain + n)));
    }
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  // the truth, for scoring
  const yAtFrames = frameTimes.map((t) => posAt(t + exposure / 2).ymm);
  // where the plate's centre was in each frame (native px, the middle of the exposure; no shake)
  const centers = frameTimes.map((t) => {
    const p = posAt(t + exposure / 2);
    const [cx, cy] = toPx(p.xmm, p.ymm);
    return [Math.round(cx * 100) / 100, Math.round(cy * 100) / 100];
  });
  writeFileSync(
    `${file}.json`,
    JSON.stringify({
      scene: { ...scene, phases: undefined },
      mmPerPx,
      plateRadiusPx: R,
      reps: truth.reps,
      frameTimes,
      yAtFrames,
      centers,
      axes: [R * yawQ, R * pitchQ],
    }),
  );
  return { truth, frames: k, file, scene, mmPerPx };
}

function drawPlate(
  fr: Canvas,
  posAt: (t: number) => { xmm: number; ymm: number },
  toPx: (x: number, y: number) => [number, number],
  t: number,
  exposure: number,
  R: number,
  yawQ: number,
  pitchQ: number,
  style: PlateStyle,
  light: number,
  sx: number,
  sy: number,
  band = 0,
) {
  const N = 6;
  const subs: [number, number][] = [];
  for (let s = 0; s < N; s++) {
    const ts = t + (exposure * (s + 0.5)) / N;
    const p = posAt(ts);
    const [px, py] = toPx(p.xmm, p.ymm);
    subs.push([px + sx, py + sy]);
  }
  const xs = subs.map((p) => p[0]);
  const ys = subs.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - R - 2 - Math.max(0, -band)));
  const x1 = Math.min(fr.w - 1, Math.ceil(Math.max(...xs) + R + 2 + Math.max(0, band)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - R - 2));
  const y1 = Math.min(fr.h - 1, Math.ceil(Math.max(...ys) + R + 2));
  // the bar spins a little as it moves (lettering turns)
  const spin = 0.002 * posAt(t).ymm;
  const a = R * yawQ;
  const b = R * pitchQ;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let cov = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (const [px, py] of subs)
        for (let qy = 0; qy < 2; qy++)
          for (let qx = 0; qx < 2; qx++) {
            const dxp = x + 0.25 + 0.5 * qx - px;
            const u = dxp / a;
            const v = (y + 0.25 + 0.5 * qy - py) / b;
            let c: RGB;
            if (u * u + v * v <= 1) c = plateColor(style, u, v, spin, light);
            else if (band) {
              // the edge of the stack: the face swept back by the stack's depth
              const sh = Math.max(0, Math.min(1, dxp / band)) * band;
              const ue = (dxp - sh) / a;
              if (ue * ue + v * v > 1) continue;
              c = plateEdge(style, v, light);
            } else continue;
            cov++;
            cr += c[0];
            cg += c[1];
            cb += c[2];
          }
      if (!cov) continue;
      const total = subs.length * 4;
      fr.blend(y * fr.w + x, [cr / cov, cg / cov, cb / cov], cov / total);
    }
}

/** The lifter, behind the plate: dark clothes, skin, a head (round), limbs that move with the bar. */
function drawLifter(
  fr: Canvas,
  lift: Lift,
  bx: number,
  by: number,
  floorY: number,
  mmPerPx: number,
  light: number,
  ymm: number,
  truth: Truth,
) {
  const m = (mm: number) => mm / mmPerPx;
  const cloth: RGB = shade([40, 44, 58], light);
  const cloth2: RGB = shade([30, 30, 34], light);
  const skin: RGB = shade([176, 132, 108], light);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < truth.y.length; i += 50) {
    lo = Math.min(lo, truth.y[i]);
    hi = Math.max(hi, truth.y[i]);
  }
  const depth = hi > lo ? (hi - ymm) / (hi - lo) : 0; // 0 at the top, 1 at the bottom of the range
  if (lift === "squat") {
    const hipX = bx - m(120 + 260 * depth);
    const hipY = by + m(480 - 150 * depth);
    const kneeX = bx + m(80 + 220 * depth);
    const kneeY = floorY - m(480 - 40 * depth);
    fr.limb(hipX, hipY, kneeX, kneeY, m(190), cloth2);
    fr.limb(kneeX, kneeY, bx - m(20), floorY - m(40), m(130), cloth2);
    fr.ellipse(bx - m(40), floorY - m(30), m(140), m(45), cloth2);
    fr.limb(hipX, hipY, bx - m(40), by + m(40), m(300), cloth);
    fr.ellipse(bx + m(70 + 60 * depth), by - m(150), m(105), m(120), skin);
    fr.limb(bx - m(30), by + m(60), bx + m(160), by + m(140), m(90), skin);
  } else if (lift === "bench") {
    const padY = floorY - m(430);
    fr.ellipse(bx - m(150), padY - m(160), m(420), m(130), cloth);
    fr.ellipse(bx + m(330), padY - m(170), m(110), m(115), skin); // the head on the bench
    fr.limb(bx - m(500), padY - m(120), bx - m(800), floorY - m(60), m(170), cloth2);
    // the arm up to the bar
    fr.limb(bx - m(40), padY - m(200), bx, by + m(60), m(95), skin);
  } else {
    const sumo = lift === "sumo";
    const hipX = bx - m(sumo ? 160 : 260) - m(140) * depth;
    const hipY = floorY - m(sumo ? 700 : 760) + m(sumo ? 200 : 260) * depth;
    const shX = bx + m(30);
    const shY = hipY - m(520) + m(160) * depth;
    fr.limb(hipX, hipY, bx + m(sumo ? 160 : 60), floorY - m(430) + m(80) * depth, m(200), cloth2);
    fr.limb(
      bx + m(sumo ? 160 : 60),
      floorY - m(430) + m(80) * depth,
      bx - m(20),
      floorY - m(40),
      m(130),
      cloth2,
    );
    fr.limb(hipX, hipY, shX, shY, m(320), cloth);
    fr.ellipse(shX + m(90), shY - m(170), m(105), m(118), skin);
    fr.limb(shX, shY + m(40), bx, by, m(90), skin);
  }
}

/** Score a read against the truth: the engine's reps matched by time to the true concentrics. */
export function matchReps(
  truthReps: { start: number; end: number; rom: number; mcv: number; peak: number }[],
  reps: {
    con: { start: number; end: number };
    mcv: { v: number | null; tier: string };
    rom: { v: number | null };
    complete: boolean;
  }[],
) {
  return truthReps.map((tr) => {
    const r = reps.find((x) => x.con.start < tr.end && x.con.end > tr.start);
    return {
      true: Number((tr.mcv / 1000).toFixed(3)),
      got: r?.mcv.v ?? null,
      tier: r?.mcv.tier ?? "missing",
      err: r?.mcv.v != null ? Number((r.mcv.v - tr.mcv / 1000).toFixed(3)) : null,
      romTrue: Math.round(tr.rom),
      rom: r?.rom.v != null ? Math.round(r.rom.v) : null,
      complete: r?.complete ?? false,
    };
  });
}
