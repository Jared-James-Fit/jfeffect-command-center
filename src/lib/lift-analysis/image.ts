/**
 * Greyscale frames and their gradients, the raw material of lift analysis
 * (pure, no browser APIs). Everything works on a region of the frame, so the
 * tracker only ever touches the pixels around the plate.
 */

/** A greyscale picture: `px` is w × h, row by row, 0 (black) … 255 (white). */
export type Gray = { w: number; h: number; px: Uint8Array };
/** A frame of the clip: its picture and its presentation time (seconds, the file's own clock). */
export type Frame = Gray & { t: number };

/** Gradients of a region, after a light blur: gx / gy / mag are rw × rh, from (x0, y0). */
export type Gradient = {
  x0: number;
  y0: number;
  w: number;
  h: number;
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
};

/** RGBA (canvas getImageData) to grey, BT.601 weights. */
export function rgbaToGray(d: Uint8ClampedArray | Uint8Array, n: number): Uint8Array {
  const px = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    px[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return px;
}

/**
 * RGBA at twice the size (2w × 2h) to grey at w × h, each pixel the mean of
 * its 2 × 2 block: an anti-aliased downscale. A browser's canvas scales a
 * video frame down without averaging, so a plate's rim stair-steps and its
 * picture shimmers frame to frame; decoding at twice the working size and
 * averaging here gives the clean edges the tracker needs (what ffmpeg's
 * scaler gives the validation harness).
 */
export function rgbaToGrayHalf(
  d: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const px = new Uint8Array(w * h);
  const W2 = 2 * w;
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * W2 * 4;
    const r1 = r0 + W2 * 4;
    for (let x = 0; x < w; x++) {
      const a = r0 + 8 * x;
      const b = r1 + 8 * x;
      const sum =
        d[a] * 77 +
        d[a + 1] * 150 +
        d[a + 2] * 29 +
        d[a + 4] * 77 +
        d[a + 5] * 150 +
        d[a + 6] * 29 +
        d[b] * 77 +
        d[b + 1] * 150 +
        d[b + 2] * 29 +
        d[b + 4] * 77 +
        d[b + 5] * 150 +
        d[b + 6] * 29;
      px[y * w + x] = (sum + 512) >> 10;
    }
  }
  return px;
}

/**
 * Sobel gradients of the region [x0, x1] × [y0, y1] (clipped to the frame),
 * after a 3 × 3 binomial blur that takes off sensor noise. A step of H grey
 * levels gives a magnitude of about 4H at the edge.
 */
export function gradients(img: Gray, x0: number, y0: number, x1: number, y1: number): Gradient {
  const { w, h, px } = img;
  const rx0 = Math.max(0, Math.floor(x0));
  const ry0 = Math.max(0, Math.floor(y0));
  const rx1 = Math.min(w - 1, Math.ceil(x1));
  const ry1 = Math.min(h - 1, Math.ceil(y1));
  const rw = Math.max(0, rx1 - rx0 + 1);
  const rh = Math.max(0, ry1 - ry0 + 1);
  const gx = new Float32Array(rw * rh);
  const gy = new Float32Array(rw * rh);
  const mag = new Float32Array(rw * rh);
  if (!rw || !rh) return { x0: rx0, y0: ry0, w: rw, h: rh, gx, gy, mag };
  // the blur needs one pixel around the region, the Sobel one more: blur an area two pixels wider
  const bx0 = Math.max(0, rx0 - 2);
  const by0 = Math.max(0, ry0 - 2);
  const bx1 = Math.min(w - 1, rx1 + 2);
  const by1 = Math.min(h - 1, ry1 + 2);
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;
  const blur = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const iy = by0 + y;
    const ym = (iy > 0 ? iy - 1 : 0) * w;
    const y0r = iy * w;
    const yp = (iy < h - 1 ? iy + 1 : h - 1) * w;
    for (let x = 0; x < bw; x++) {
      const ix = bx0 + x;
      const xm = ix > 0 ? ix - 1 : 0;
      const xp = ix < w - 1 ? ix + 1 : w - 1;
      const v =
        px[ym + xm] +
        2 * px[ym + ix] +
        px[ym + xp] +
        2 * px[y0r + xm] +
        4 * px[y0r + ix] +
        2 * px[y0r + xp] +
        px[yp + xm] +
        2 * px[yp + ix] +
        px[yp + xp];
      blur[y * bw + x] = v * 0.0625;
    }
  }
  for (let y = 0; y < rh; y++) {
    const by = ry0 + y - by0;
    const r0 = (by > 0 ? by - 1 : 0) * bw;
    const r2 = (by < bh - 1 ? by + 1 : bh - 1) * bw;
    const r1 = by * bw;
    for (let x = 0; x < rw; x++) {
      const bx = rx0 + x - bx0;
      const c0 = bx > 0 ? bx - 1 : 0;
      const c2 = bx < bw - 1 ? bx + 1 : bw - 1;
      const a00 = blur[r0 + c0],
        a01 = blur[r0 + bx],
        a02 = blur[r0 + c2];
      const a10 = blur[r1 + c0],
        a12 = blur[r1 + c2];
      const a20 = blur[r2 + c0],
        a21 = blur[r2 + bx],
        a22 = blur[r2 + c2];
      const sx = a02 + 2 * a12 + a22 - a00 - 2 * a10 - a20;
      const sy = a20 + 2 * a21 + a22 - a00 - 2 * a01 - a02;
      const i = y * rw + x;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { x0: rx0, y0: ry0, w: rw, h: rh, gx, gy, mag };
}

/**
 * The gradient at a point of the frame (sub-pixel, bilinear), or null outside
 * the region. Written for the hot loops: no allocation, the answer goes in `out`.
 */
export function sampleGrad(g: Gradient, x: number, y: number, out: [number, number]): boolean {
  const fx = x - g.x0;
  const fy = y - g.y0;
  if (!(fx >= 0 && fy >= 0 && fx <= g.w - 1 && fy <= g.h - 1)) return false;
  const ix = Math.min(g.w - 2, Math.floor(fx));
  const iy = Math.min(g.h - 2, Math.floor(fy));
  if (ix < 0 || iy < 0) return false;
  const dx = fx - ix;
  const dy = fy - iy;
  const i = iy * g.w + ix;
  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;
  out[0] = g.gx[i] * w00 + g.gx[i + 1] * w10 + g.gx[i + g.w] * w01 + g.gx[i + g.w + 1] * w11;
  out[1] = g.gy[i] * w00 + g.gy[i + 1] * w10 + g.gy[i + g.w] * w01 + g.gy[i + g.w + 1] * w11;
  return true;
}

/** The p-th percentile (0…1) of an array's values (a copy is sorted; fine for the sizes here). */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (!n) return 0;
  // a histogram for big arrays of non-negative values (gradient magnitudes): exact enough, no sort
  if (n > 4096) {
    let max = 0;
    for (let i = 0; i < n; i++) if (values[i] > max) max = values[i];
    if (!(max > 0)) return 0;
    const bins = 1024;
    const hist = new Uint32Array(bins);
    for (let i = 0; i < n; i++)
      hist[Math.min(bins - 1, Math.floor((values[i] / max) * (bins - 1)))]++;
    const target = p * n;
    let seen = 0;
    for (let b = 0; b < bins; b++) {
      seen += hist[b];
      if (seen >= target) return ((b + 0.5) / (bins - 1)) * max;
    }
    return max;
  }
  const s = Array.from(values).sort((a, b) => a - b);
  return s[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation, as a standard deviation (× 1.4826). */
export function madSigma(values: number[]): number {
  if (values.length < 2) return 0;
  const m = median(values);
  return 1.4826 * median(values.map((v) => Math.abs(v - m)));
}
