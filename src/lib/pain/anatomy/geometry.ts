/**
 * Geometry for the anatomical body map (pure, tested): the drawing is authored
 * as point lists ("x,y x,y!") on one side of the body and smoothed into paths,
 * mirrored across the midline for the other side. Bounding boxes and centres
 * are worked out here too, so the map can zoom to a region and place its
 * labels without asking the browser for anything.
 */

export type Pt = [number, number];

/** The drawing's width; the body's midline is x = MID. */
export const VIEW_W = 400;
export const VIEW_H = 920;
export const MID = VIEW_W / 2;

/** "x,y x,y! x,y": a "!" marks a corner (no smoothing through it). */
export function parsePoints(spec: string): { pts: Pt[]; corners: Set<number> } {
  const pts: Pt[] = [];
  const corners = new Set<number>();
  for (const tok of spec.trim().split(/\s+/)) {
    if (!tok) continue;
    const corner = tok.endsWith("!");
    const [x, y] = tok.replace("!", "").split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (corner) corners.add(pts.length);
    pts.push([x, y]);
  }
  return { pts, corners };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A closed, smooth path through the points (Catmull-Rom as cubic Béziers),
 * straight into and out of any corner.
 */
export function smoothPath(pts: Pt[], corners: Set<number> = new Set(), tension = 0.5): string {
  const n = pts.length;
  if (n < 3) return "";
  const k = tension / 3;
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1: Pt = corners.has(i) ? p1 : [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Pt = corners.has((i + 1) % n) ? p2 : [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return `${d}Z`;
}

/**
 * The same closed curve as `smoothPath`, as points (a few along each Bézier):
 * what a tap is tested against, so it lands on exactly what's drawn.
 */
export function smoothPolygon(pts: Pt[], corners: Set<number> = new Set(), tension = 0.5, steps = 6): Pt[] {
  const n = pts.length;
  if (n < 3) return pts;
  const k = tension / 3;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1: Pt = corners.has(i) ? p1 : [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Pt = corners.has((i + 1) % n) ? p2 : [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p1[0] + b * c1[0] + c * c2[0] + d * p2[0], a * p1[1] + b * c1[1] + c * c2[1] + d * p2[1]]);
    }
  }
  return out;
}

/** An open, smooth line (a tendon edge, a groove). */
export function smoothLine(pts: Pt[], tension = 0.5): string {
  const n = pts.length;
  if (n < 2) return "";
  const k = tension / 3;
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) * k)} ${r1(p1[1] + (p2[1] - p0[1]) * k)} ${r1(p2[0] - (p3[0] - p1[0]) * k)} ${r1(p2[1] - (p3[1] - p1[1]) * k)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}

export function mirrorPts(pts: Pt[], mid = MID): Pt[] {
  return pts.map(([x, y]) => [2 * mid - x, y]);
}

export type Box = { x: number; y: number; w: number; h: number };

export function bboxOf(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The area-weighted centre of a polygon (falls back to the points' mean). */
export function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Is the point inside the polygon (even-odd)? */
export function inside(pt: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from a point to a polygon's edge (0 inside). */
export function distanceTo(pt: Pt, poly: Pt[]): number {
  if (inside(pt, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / len));
    const d = Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/** An ellipse as a polygon (for hit tests and boxes). */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}
