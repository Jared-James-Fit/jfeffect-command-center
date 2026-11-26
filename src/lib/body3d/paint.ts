/**
 * The muscle map's colours painted onto the anatomical drawing's three views
 * (front, back, side), one canvas each, for the 3D body to wear and the 2D
 * fallback to show. Skin everywhere, each trained muscle in its colour, fine
 * dark lines between muscles so the anatomy reads, and the picked muscle
 * lifted with a light edge.
 *
 * What the athlete reported (Nov 26 2026) is drawn over that, never mixed
 * into it, so nobody reads a symptom as fatigue or the other way round:
 * fatigue is a solid colour per muscle (an estimate from the log); a reported
 * symptom is a hatch with an outline on the exact spot, anywhere on the body
 * (the head, a finger, the ball of the foot), in its own colour: pain, a joint
 * or numbness in rose, a headache in blue, soreness or tightness they
 * reported as a dotted outline (it confirms fatigue, it isn't a new problem).
 */
import { atlasView, type AtlasPart, type AtlasView, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { muscleOfSite } from "@/lib/body3d/muscle-sites";
import { siteCovers } from "@/lib/pain/sites";
import type { FineMuscle } from "@/lib/analytics/training-load";

/** A reported symptom to draw: where, and which of the three looks it takes. */
export type BodyMark = {
  region: string;
  site: string | null;
  side: "L" | "R" | null;
  tone: "limit" | "general" | "reported";
};

export const MARK_COLORS: Record<"light" | "dark", Record<BodyMark["tone"], string>> = {
  light: { limit: "#e11d48", general: "#2563eb", reported: "#111317" },
  dark: { limit: "#fb7185", general: "#60a5fa", reported: "#ffffff" },
};

/** Does a part show this mark? The spot (or a spot its group covers), else the whole region; a side only where the view has sides. */
export function partShowsMark(p: Pick<AtlasPart, "site" | "region" | "side">, m: BodyMark, sided: boolean): boolean {
  if (!p.site) return false;
  if (m.site) {
    if (p.site !== m.site && !siteCovers(m.site).includes(p.site)) return false;
  } else if (p.region !== m.region) return false;
  if (!sided || m.side == null || p.side == null) return true;
  return p.side === m.side;
}

function hatch(g: CanvasRenderingContext2D, color: string, dotted: boolean): CanvasPattern | null {
  const t = document.createElement("canvas");
  t.width = 8;
  t.height = 8;
  const c = t.getContext("2d");
  if (!c) return null;
  c.strokeStyle = color;
  c.fillStyle = color;
  if (dotted) {
    c.globalAlpha = 0.7;
    c.beginPath();
    c.arc(4, 4, 1.1, 0, Math.PI * 2);
    c.fill();
  } else {
    c.globalAlpha = 0.85;
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(-2, 10);
    c.lineTo(10, -2);
    c.moveTo(-2, 2);
    c.lineTo(2, -2);
    c.moveTo(6, 10);
    c.lineTo(10, 6);
    c.stroke();
  }
  return g.createPattern(t, "repeat");
}

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
  marks: BodyMark[] = [],
  dark = false,
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
  if (marks.length) paintMarks(g, v, marks, dark);
  return c;
}

/** Reported symptoms over the colours: a hatch and an edge on each spot (the side view shows either side). */
export function paintMarks(g: CanvasRenderingContext2D, v: AtlasView, marks: BodyMark[], dark: boolean) {
  const palette = MARK_COLORS[dark ? "dark" : "light"];
  // the most pressing look last, so it's on top
  const order: BodyMark["tone"][] = ["reported", "general", "limit"];
  for (const tone of order) {
    const ms = marks.filter((m) => m.tone === tone);
    if (!ms.length) continue;
    const fill = hatch(g, palette[tone], tone === "reported");
    for (const p of v.parts) {
      // a deep part shows only when it's the very spot reported
      if (p.deep && !ms.some((m) => m.site === p.site)) continue;
      if (!ms.some((m) => partShowsMark(p, m, v.key !== "side"))) continue;
      const path = new Path2D(p.d);
      if (fill) {
        g.fillStyle = fill;
        g.fill(path);
      }
      g.lineWidth = tone === "reported" ? 1.6 : 2;
      g.setLineDash(tone === "reported" ? [3, 2.5] : []);
      g.strokeStyle = palette[tone];
      g.stroke(path);
      g.setLineDash([]);
    }
  }
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
