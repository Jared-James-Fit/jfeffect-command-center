/**
 * The body map's stage (pure, tested): how the drawing sits on the screen,
 * how a pinch or a tap on a region zooms it, how far it may be panned, and
 * where the labels of the structures in view go. The map applies the result
 * as one CSS transform, so nothing is redrawn while the fingers move.
 */
import { VIEW_H, VIEW_W, type Box, type Pt } from "@/lib/pain/anatomy/geometry";

export type Size = { w: number; h: number };
/** The drawing fitted to the stage: `k` drawing units → px, offset (ox, oy). */
export type Fit = { k: number; ox: number; oy: number };
/** The zoom on top: scale `s` about the stage's top-left, then (tx, ty). */
export type Xf = { s: number; tx: number; ty: number };

/** At this zoom and past it, a tap picks a spot (below it, a tap zooms into the region). */
export const DETAIL_SCALE = 1.7;
export const MAX_SCALE = 7;
export const IDENTITY: Xf = { s: 1, tx: 0, ty: 0 };

/**
 * The drawing fitted to the stage the way the SVG itself fits (`xMidYMid
 * meet`, no padding), so a point on the screen and a point in the drawing
 * always agree: a tap lands on exactly what's under the finger.
 */
export function fitView(size: Size, pad = 0): Fit {
  const w = Math.max(1, size.w - pad * 2);
  const h = Math.max(1, size.h - pad * 2);
  const k = Math.min(w / VIEW_W, h / VIEW_H);
  return { k, ox: (size.w - VIEW_W * k) / 2, oy: (size.h - VIEW_H * k) / 2 };
}

export function toScreen(pt: Pt, fit: Fit, xf: Xf): Pt {
  return [xf.tx + xf.s * (fit.ox + fit.k * pt[0]), xf.ty + xf.s * (fit.oy + fit.k * pt[1])];
}

export function toDrawing(sx: number, sy: number, fit: Fit, xf: Xf): Pt {
  return [((sx - xf.tx) / xf.s - fit.ox) / fit.k, ((sy - xf.ty) / xf.s - fit.oy) / fit.k];
}

/** The part of the stage the drawing can be seen in (a sheet over its bottom takes `bottom`). */
export type Visible = { top: number; bottom: number };

/** How far a tap on an area zooms at most: close enough to tell its parts apart, never so close they fill the screen. */
export const FRAME_MAX_SCALE = 5;

/**
 * A zoom that frames the box in the visible part of the stage, never past
 * FRAME_MAX_SCALE or under 1. `sideRoom` is kept free on each side (the
 * labels' columns), so what's framed sits between them, not under them.
 */
export function frameBox(box: Box, size: Size, fit: Fit, vis: Visible = { top: 0, bottom: 0 }, fill = 0.86, sideRoom = 0): Xf {
  const vh = Math.max(40, size.h - vis.top - vis.bottom);
  const vw = Math.max(60, size.w - sideRoom * 2);
  const s = clamp(Math.min((vw * fill) / (box.w * fit.k), (vh * fill) / (box.h * fit.k)), 1, FRAME_MAX_SCALE);
  const cx = fit.ox + fit.k * (box.x + box.w / 2);
  const cy = fit.oy + fit.k * (box.y + box.h / 2);
  return clampXf({ s, tx: size.w / 2 - s * cx, ty: vis.top + vh / 2 - s * cy }, size, fit, vis);
}

/** Bring a point to the middle of the visible part, keeping the zoom. */
export function centerOn(pt: Pt, xf: Xf, size: Size, fit: Fit, vis: Visible): Xf {
  const vh = Math.max(40, size.h - vis.top - vis.bottom);
  return clampXf({ s: xf.s, tx: size.w / 2 - xf.s * (fit.ox + fit.k * pt[0]), ty: vis.top + vh / 2 - xf.s * (fit.oy + fit.k * pt[1]) }, size, fit, vis);
}

/** Zoom to `s` keeping the screen point `at` where it is (a pinch's midpoint, a wheel's cursor). */
export function zoomAt(xf: Xf, s: number, at: Pt): Xf {
  const next = clamp(s, 1, MAX_SCALE);
  const r = next / xf.s;
  return { s: next, tx: at[0] - (at[0] - xf.tx) * r, ty: at[1] - (at[1] - xf.ty) * r };
}

/**
 * Keep the drawing on the stage: zoomed in, it can be panned until its edge
 * reaches the middle of the visible part, never further (no getting lost in
 * the black); at 1 it sits where it fits.
 */
export function clampXf(xf: Xf, size: Size, fit: Fit, vis: Visible = { top: 0, bottom: 0 }): Xf {
  const s = clamp(xf.s, 1, MAX_SCALE);
  if (s <= 1.001) return { s: 1, tx: 0, ty: 0 };
  const left = fit.ox * s;
  const right = (fit.ox + VIEW_W * fit.k) * s;
  const top = fit.oy * s;
  const bottom = (fit.oy + VIEW_H * fit.k) * s;
  const vh = Math.max(40, size.h - vis.top - vis.bottom);
  const midX = size.w / 2;
  const midY = vis.top + vh / 2;
  // the drawing's left edge may come to the middle, never past it (and the same for each edge)
  const tx = clamp(xf.tx, midX - right, midX - left);
  const ty = clamp(xf.ty, midY - bottom, midY - top);
  return { s, tx, ty };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** A structure to label; `h` is its label's height when the labels differ (else `labelH`). */
export type Anchor = { id: string; x: number; y: number; h?: number };
export type Callout = { id: string; side: "l" | "r"; x: number; y: number; h: number; ax: number; ay: number };

/**
 * Labels for the structures in view, Netter's way: two columns at the stage's
 * edges, each label at its structure's height where it can be, pushed apart
 * so none overlap, with a leader line to the structure. A structure goes to
 * the nearer edge; a full column overflows to the other; what still doesn't
 * fit is left out (it's still tappable, and in the list). Labels can differ in
 * height (a long name wraps instead of being cut off).
 */
export function layoutCallouts(
  anchors: Anchor[],
  size: Size,
  opts: { labelW: number; labelH: number; gap?: number; top?: number; bottom?: number; margin?: number },
): Callout[] {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const top = (opts.top ?? 0) + 4;
  const bottom = size.h - (opts.bottom ?? 0) - 4;
  const room = bottom - top;
  const hOf = (a: Anchor) => a.h ?? opts.labelH;
  // the height a column of labels takes, stacked with gaps
  const need = (col: Anchor[]) => col.reduce((sum, a) => sum + hOf(a), 0) + Math.max(0, col.length - 1) * gap;
  const sorted = [...anchors].sort((a, b) => a.y - b.y);
  const left: Anchor[] = [];
  const right: Anchor[] = [];
  for (const a of sorted) (a.x < size.w / 2 ? left : right).push(a);
  // a full column hands its extra to the other (the ones nearest the middle move)
  const balance = (from: Anchor[], to: Anchor[]) => {
    while (from.length && need(from) > room) {
      const i = from.reduce((best, a, j) => (Math.abs(a.x - size.w / 2) < Math.abs(from[best].x - size.w / 2) ? j : best), 0);
      if (need([...to, from[i]]) > room) break;
      to.push(...from.splice(i, 1));
      to.sort((a, b) => a.y - b.y);
    }
  };
  balance(left, right);
  balance(right, left);
  const place = (col: Anchor[], side: "l" | "r"): Callout[] => {
    // top down, as many as the column holds
    const list: Anchor[] = [];
    for (const a of col) {
      if (need([...list, a]) > room) break;
      list.push(a);
    }
    const hs = list.map(hOf);
    const ys = list.map((a, i) => clamp(a.y - hs[i] / 2, top, bottom - hs[i]));
    // push down to clear the one above, then up from the bottom to fit
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + hs[i - 1] + gap);
    const last = ys.length - 1;
    if (last >= 0 && ys[last] > bottom - hs[last]) {
      ys[last] = bottom - hs[last];
      for (let i = last - 1; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - hs[i] - gap);
    }
    const x = side === "l" ? margin : size.w - margin - opts.labelW;
    return list.map((a, i) => ({ id: a.id, side, x, y: ys[i], h: hs[i], ax: a.x, ay: a.y }));
  };
  return [...place(left, "l"), ...place(right, "r")];
}

/** How a label is sized: its name wraps to up to `maxLines`, never cut mid-word unless a word alone is too wide. */
export const LABEL_TYPE = { padY: 5, nameLine: 15, anatLine: 13, minH: 40, maxLines: 3 } as const;

/**
 * The lines a label's name takes at `width` (greedy word wrap, like the
 * browser's), measured with `measure` (a canvas in the app, a stub in tests).
 * `lead` is the width of anything before the name on its first line (the
 * "L" / "R" tag).
 */
export function wrapLines(text: string, width: number, measure: (s: string) => number, lead = 0): number {
  const space = measure(" ");
  let lines = 1;
  let used = 0;
  let room = width - lead;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = measure(word);
    const add = used ? space + w : w;
    if (used + add <= room) {
      used += add;
      continue;
    }
    if (used) {
      lines += 1;
      room = width;
    }
    // a word wider than a whole line breaks inside itself (overflow-wrap)
    while (w > room) {
      lines += 1;
      w -= room;
      room = width;
    }
    used = w;
  }
  return lines;
}

/** A label's height: its name's lines, the anatomical name under it unless the name already takes every line. */
export function labelHeight(nameLines: number, hasAnat: boolean): { h: number; lines: number; anat: boolean } {
  const lines = Math.max(1, Math.min(LABEL_TYPE.maxLines, nameLines));
  const anat = hasAnat && lines < LABEL_TYPE.maxLines;
  const h = Math.max(LABEL_TYPE.minH, LABEL_TYPE.padY * 2 + lines * LABEL_TYPE.nameLine + (anat ? LABEL_TYPE.anatLine : 0));
  return { h, lines, anat };
}
