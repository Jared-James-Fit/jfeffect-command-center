/**
 * Did the camera move? (pure) A phone propped on the floor doesn't; one held
 * in a hand does, and then everything in the picture moves, the plate too,
 * so no speed read from it can be trusted as measured. The background is
 * compared frame to frame at a quarter size in four corner tiles (away from
 * the lifter), and the median tile's best shift is the camera's.
 */
import type { Gray } from "@/lib/lift-analysis/image";

const F = 4;

function shrink(img: Gray): { w: number; h: number; px: Float32Array } {
  const w = Math.floor(img.w / F);
  const h = Math.floor(img.h / F);
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < F; dy++) {
        const row = (y * F + dy) * img.w + x * F;
        for (let dx = 0; dx < F; dx++) s += img.px[row + dx];
      }
      px[y * w + x] = s / (F * F);
    }
  }
  return { w, h, px };
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** The camera's shift between two frames (frame px) and how sure (false when the background is too plain to tell). */
export function cameraShift(
  a: Gray,
  b: Gray,
  exclude?: Box,
): { dx: number; dy: number; ok: boolean } {
  if (a.w !== b.w || a.h !== b.h || a.w < 64 || a.h < 64) return { dx: 0, dy: 0, ok: false };
  const A = shrink(a);
  const B = shrink(b);
  const R = 3;
  const tw = Math.floor(A.w / 3);
  const th = Math.floor(A.h / 4);
  const tiles: Box[] = [
    { x0: R, y0: R, x1: R + tw, y1: R + th },
    { x0: A.w - R - tw, y0: R, x1: A.w - R, y1: R + th },
    { x0: R, y0: A.h - R - th, x1: R + tw, y1: A.h - R },
    { x0: A.w - R - tw, y0: A.h - R - th, x1: A.w - R, y1: A.h - R },
  ];
  const ex = exclude && {
    x0: exclude.x0 / F,
    y0: exclude.y0 / F,
    x1: exclude.x1 / F,
    y1: exclude.y1 / F,
  };
  const shifts: { dx: number; dy: number }[] = [];
  for (const t of tiles) {
    if (ex && t.x0 < ex.x1 && t.x1 > ex.x0 && t.y0 < ex.y1 && t.y1 > ex.y0) continue;
    // mean-removed SAD (an exposure change shifts every pixel the same)
    let ma = 0;
    let n = 0;
    for (let y = t.y0; y < t.y1; y++)
      for (let x = t.x0; x < t.x1; x++) {
        ma += A.px[y * A.w + x];
        n++;
      }
    ma /= n;
    let texture = 0;
    for (let y = t.y0; y < t.y1; y++)
      for (let x = t.x0 + 1; x < t.x1; x++)
        texture += Math.abs(A.px[y * A.w + x] - A.px[y * A.w + x - 1]);
    if (texture / n < 1.5) continue; // a plain wall: no way to tell
    const cost = new Float64Array((2 * R + 1) ** 2);
    for (let sy = -R; sy <= R; sy++) {
      for (let sx = -R; sx <= R; sx++) {
        let mb = 0;
        for (let y = t.y0; y < t.y1; y++)
          for (let x = t.x0; x < t.x1; x++) mb += B.px[(y + sy) * B.w + x + sx];
        mb /= n;
        let c = 0;
        for (let y = t.y0; y < t.y1; y++)
          for (let x = t.x0; x < t.x1; x++)
            c += Math.abs(A.px[y * A.w + x] - ma - (B.px[(y + sy) * B.w + x + sx] - mb));
        cost[(sy + R) * (2 * R + 1) + sx + R] = c;
      }
    }
    let bi = 0;
    for (let i = 1; i < cost.length; i++) if (cost[i] < cost[bi]) bi = i;
    const by = Math.floor(bi / (2 * R + 1)) - R;
    const bx = (bi % (2 * R + 1)) - R;
    // sub-pixel: a parabola through the best and its neighbours, each way
    const at = (sx: number, sy: number) => cost[(sy + R) * (2 * R + 1) + sx + R];
    const sub = (m: number, c0: number, p: number) => {
      const d = m - 2 * c0 + p;
      return d > 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / d)) : 0;
    };
    const fx = Math.abs(bx) < R ? sub(at(bx - 1, by), at(bx, by), at(bx + 1, by)) : 0;
    const fy = Math.abs(by) < R ? sub(at(bx, by - 1), at(bx, by), at(bx, by + 1)) : 0;
    shifts.push({ dx: (bx + fx) * F, dy: (by + fy) * F });
  }
  if (shifts.length < 2) return { dx: 0, dy: 0, ok: false };
  const med = (v: number[]) => {
    const s = [...v].sort((p, q) => p - q);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { dx: med(shifts.map((s) => s.dx)), dy: med(shifts.map((s) => s.dy)), ok: true };
}
