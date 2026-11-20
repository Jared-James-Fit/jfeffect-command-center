/**
 * The body map's shapes and what a tap lands on (pure, tested). Two figures,
 * front and back, side by side in one 400 × 440 drawing: nothing to flip, and
 * the shapes are simple (ellipses, rounded rectangles, one polygon) so a tap
 * can be resolved in code, not by the browser's hit testing: a tap inside a
 * shape picks it, a tap just outside picks the nearest one within reach,
 * which makes the small places (neck, elbow, wrist) easy to hit with a thumb.
 *
 * Sides are anatomical: on the front figure the client's right is on the
 * left of the screen (they're facing you), on the back figure it's on the
 * right. Each figure is labelled R / L so nobody has to work that out.
 */
import type { PainSide } from "@/lib/pain/regions";

export type Shape =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number }
  | { kind: "poly"; points: [number, number][] };

export type MapRegion = { id: string; region: string; side: PainSide | null; view: "front" | "back"; shape: Shape };

export const MAP_WIDTH = 400;
export const MAP_HEIGHT = 440;
/** The back figure is drawn 200 to the right of the front one. */
const BACK_X = 200;
/** How far outside a shape a tap still counts (drawing units, ~10px on a phone). */
export const TAP_REACH = 12;

const e = (cx: number, cy: number, rx: number, ry: number): Shape => ({ kind: "ellipse", cx, cy, rx, ry });
const r = (x: number, y: number, w: number, h: number, rr = 8): Shape => ({ kind: "rect", x, y, w, h, r: rr });

/** Mirror a front-figure shape across the body's midline (x = 100). */
function mirror(s: Shape): Shape {
  if (s.kind === "ellipse") return { ...s, cx: 200 - s.cx };
  if (s.kind === "rect") return { ...s, x: 200 - s.x - s.w };
  return { kind: "poly", points: s.points.map(([x, y]) => [200 - x, y]) };
}

function shift(s: Shape, dx: number): Shape {
  if (s.kind === "ellipse") return { ...s, cx: s.cx + dx };
  if (s.kind === "rect") return { ...s, x: s.x + dx };
  return { kind: "poly", points: s.points.map(([x, y]) => [x + dx, y]) };
}

/** Head (drawn, never picked). */
export const HEAD: Shape = e(100, 34, 18, 23);

// One side of the figure, drawn on the screen's left (x < 100); each is mirrored onto the right.
// Zones touch, so the figure reads as one body with seams; a 2-unit seam is drawn between them.
const PAIRED_FRONT: [string, Shape][] = [
  ["chest", r(72, 78, 29, 38, 10)],
  ["shoulder", e(63, 92, 17, 15)],
  ["upper_arm", r(45, 106, 19, 40, 9)],
  ["elbow", r(43, 147, 19, 30, 9)],
  ["wrist_hand", r(41, 178, 19, 50, 9)],
  ["hip_groin", r(76, 164, 25, 28, 9)],
  ["quad", r(76, 193, 25, 76, 11)],
  ["knee", r(79, 270, 21, 24, 9)],
  ["shin", r(80, 295, 19, 64, 8)],
  ["ankle_foot", r(78, 360, 22, 32, 8)],
];
const MID_FRONT: [string, Shape][] = [
  ["neck", r(89, 56, 22, 22, 7)],
  ["abs", r(76, 117, 48, 46, 10)],
];
const PAIRED_BACK: [string, Shape][] = [
  ["shoulder_blade", r(74, 97, 27, 31, 10)],
  ["shoulder", e(63, 92, 17, 15)],
  ["upper_arm", r(45, 106, 19, 40, 9)],
  ["elbow", r(43, 147, 19, 30, 9)],
  ["wrist_hand", r(41, 178, 19, 50, 9)],
  ["glute", r(76, 175, 25, 32, 12)],
  ["hamstring", r(76, 208, 25, 61, 11)],
  ["knee", r(79, 270, 21, 24, 9)],
  ["calf", r(79, 295, 21, 64, 9)],
  ["ankle_foot", r(78, 360, 22, 32, 8)],
];
const MID_BACK: [string, Shape][] = [
  ["neck", r(89, 56, 22, 22, 7)],
  ["upper_back", { kind: "poly", points: [[84, 78], [116, 78], [128, 90], [100, 96], [72, 90]] }],
  ["mid_back", r(77, 129, 46, 22, 8)],
  ["low_back", r(76, 152, 48, 22, 8)],
];

function build(): MapRegion[] {
  const out: MapRegion[] = [];
  // front: the screen's left is the client's right
  for (const [region, s] of PAIRED_FRONT) {
    out.push({ id: `front:${region}:R`, region, side: "R", view: "front", shape: s });
    out.push({ id: `front:${region}:L`, region, side: "L", view: "front", shape: mirror(s) });
  }
  for (const [region, s] of MID_FRONT) out.push({ id: `front:${region}`, region, side: null, view: "front", shape: s });
  // back: the screen's left is the client's left
  for (const [region, s] of PAIRED_BACK) {
    out.push({ id: `back:${region}:L`, region, side: "L", view: "back", shape: shift(s, BACK_X) });
    out.push({ id: `back:${region}:R`, region, side: "R", view: "back", shape: shift(mirror(s), BACK_X) });
  }
  for (const [region, s] of MID_BACK) out.push({ id: `back:${region}`, region, side: null, view: "back", shape: shift(s, BACK_X) });
  return out;
}

export const MAP_REGIONS: readonly MapRegion[] = build();
export const BACK_HEAD: Shape = shift(HEAD, BACK_X);

/** Distance from a point to a shape's edge: ≤ 0 inside. */
export function distanceTo(s: Shape, x: number, y: number): number {
  if (s.kind === "ellipse") {
    const nx = (x - s.cx) / s.rx;
    const ny = (y - s.cy) / s.ry;
    const k = Math.hypot(nx, ny);
    if (k === 0) return -Math.min(s.rx, s.ry);
    // close enough for a tap: the radial gap scaled by the ellipse's size in that direction
    const rad = Math.hypot((x - s.cx) / k, (y - s.cy) / k);
    return (k - 1) * rad;
  }
  if (s.kind === "rect") {
    // signed distance to a rounded rectangle
    const hw = s.w / 2;
    const hh = s.h / 2;
    const px = Math.abs(x - (s.x + hw)) - (hw - s.r);
    const py = Math.abs(y - (s.y + hh)) - (hh - s.r);
    const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0));
    const inside = Math.min(Math.max(px, py), 0);
    return outside + inside - s.r;
  }
  const pts = s.points;
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
  }
  return inside ? -best : best;
}

/** What a tap at (x, y) in drawing units lands on, or null. */
export function regionAt(x: number, y: number, reach = TAP_REACH): MapRegion | null {
  let best: MapRegion | null = null;
  let bestD = Infinity;
  for (const m of MAP_REGIONS) {
    const d = distanceTo(m.shape, x, y);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best && bestD <= reach ? best : null;
}

/** An SVG path for a shape. */
export function shapePath(s: Shape): string {
  if (s.kind === "ellipse") {
    const { cx, cy, rx, ry } = s;
    return `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${rx * 2},0a${rx},${ry} 0 1,0 ${-rx * 2},0Z`;
  }
  if (s.kind === "rect") {
    const { x, y, w, h } = s;
    const rr = Math.min(s.r, w / 2, h / 2);
    return `M${x + rr},${y}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - 2 * rr)}a${rr},${rr} 0 0 1 ${-rr},${-rr}v${-(h - 2 * rr)}a${rr},${rr} 0 0 1 ${rr},${-rr}Z`;
  }
  return `M${s.points.map(([x, y]) => `${x},${y}`).join("L")}Z`;
}
