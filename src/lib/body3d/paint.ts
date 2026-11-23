/**
 * The muscle map's colours painted onto the anatomical drawing's three views
 * (front, back, side), one canvas each, for the 3D body to wear and the 2D
 * fallback to show. Skin everywhere, each trained muscle in its colour, fine
 * dark lines between muscles so the anatomy reads, and the picked muscle
 * lifted with a light edge.
 */
import { atlasView, type AtlasView, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { muscleOfSite } from "@/lib/body3d/muscle-sites";
import type { FineMuscle } from "@/lib/analytics/training-load";

export type BodyTheme = { skin: string; line: string; tendon: string; pickEdge: string };
export const BODY_THEME: Record<"light" | "dark", BodyTheme> = {
  light: { skin: "#d6d8dd", line: "rgba(30,32,38,0.42)", tendon: "#e4e5e8", pickEdge: "#111317" },
  dark: { skin: "#4a4d56", line: "rgba(0,0,0,0.55)", tendon: "#5a5d66", pickEdge: "#ffffff" },
};

export const PAINT_SCALE = 1.25;

export function paintView(
  key: ViewKey,
  colorOf: (m: FineMuscle) => string | null,
  theme: BodyTheme,
  picked: FineMuscle | null,
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const v: AtlasView = atlasView(key, "R");
  const c = canvas ?? document.createElement("canvas");
  c.width = Math.round(400 * PAINT_SCALE);
  c.height = Math.round(920 * PAINT_SCALE);
  const g = c.getContext("2d")!;
  g.setTransform(PAINT_SCALE, 0, 0, PAINT_SCALE, 0, 0);
  g.fillStyle = theme.skin;
  g.fillRect(0, 0, 400, 920);
  for (const p of v.parts) {
    if (p.deep) continue;
    const m = muscleOfSite(p.site);
    const path = new Path2D(p.d);
    if (p.kind === "muscle" && m) {
      g.fillStyle = colorOf(m) ?? theme.skin;
      g.fill(path);
      g.lineWidth = 0.9;
      g.strokeStyle = theme.line;
      g.stroke(path);
    } else if (p.kind === "tendon" || p.kind === "bone") {
      g.fillStyle = theme.tendon;
      g.globalAlpha = 0.5;
      g.fill(path);
      g.globalAlpha = 1;
    }
  }
  for (const l of v.lines) {
    // no grooves on the face: the head is a plain form
    const startY = Number(/^M\s*-?[\d.]+[\s,]+(-?[\d.]+)/.exec(l.d)?.[1]);
    if (Number.isFinite(startY) && startY < 140) continue;
    g.lineWidth = 0.7;
    g.strokeStyle = theme.line;
    g.stroke(new Path2D(l.d));
  }
  if (picked) {
    for (const p of v.parts) {
      if (p.deep || p.kind !== "muscle" || muscleOfSite(p.site) !== picked) continue;
      g.lineWidth = 2.4;
      g.strokeStyle = theme.pickEdge;
      g.stroke(new Path2D(p.d));
    }
  }
  return c;
}

/** The muscle under a point of one view (drawing coordinates), else the nearest within a few units. */
export function muscleAt(key: ViewKey, x: number, y: number): FineMuscle | null {
  const v = atlasView(key, "R");
  let best: FineMuscle | null = null;
  let bestD = 9;
  for (let i = v.parts.length - 1; i >= 0; i--) {
    const p = v.parts[i];
    if (p.deep || p.kind !== "muscle") continue;
    const m = muscleOfSite(p.site);
    if (!m) continue;
    const { x: bx, y: by, w, h } = p.box;
    if (x < bx - bestD || x > bx + w + bestD || y < by - bestD || y > by + h + bestD) continue;
    if (inside([x, y], p.poly)) return m;
    const d = edge([x, y], p.poly);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

function inside(pt: [number, number], poly: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

function edge(pt: [number, number], poly: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)));
  }
  return best;
}
