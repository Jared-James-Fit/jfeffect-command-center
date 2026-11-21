/**
 * The anatomical drawing, built (pure, tested): every part of a view as a
 * path with its site, side, box and centre, so the map can draw it, hit-test
 * a tap, zoom to a region and place labels without measuring the DOM.
 */
import { siteOf } from "@/lib/pain/sites";
import type { PainSide } from "@/lib/pain/regions";
import { BACK, FRONT, SIDE, type LineSpec, type PartKind, type PartSpec, type ViewSpec } from "@/lib/pain/anatomy/atlas-data";
import {
  MID,
  bboxOf,
  centroid,
  ellipsePts,
  mirrorPts,
  parsePoints,
  smoothLine,
  smoothPath,
  smoothPolygon,
  unionBox,
  type Box,
  type Pt,
} from "@/lib/pain/anatomy/geometry";

export type ViewKey = "front" | "back" | "side";
/** The side view shows one side of the body at a time. */
export type SideFacing = "R" | "L";

export type AtlasPart = {
  id: string;
  site: string | null;
  region: string | null;
  side: PainSide | null;
  kind: PartKind;
  d: string;
  poly: Pt[];
  box: Box;
  center: Pt;
  fiber: number | null;
  deep: boolean;
};

export type AtlasLine = { d: string; tone: "tendon" | "groove" };

export type AtlasView = {
  key: ViewKey;
  facing: SideFacing | null;
  silhouette: string;
  head: string;
  parts: AtlasPart[];
  lines: AtlasLine[];
};

const SPECS: Record<ViewKey, ViewSpec> = { front: FRONT, back: BACK, side: SIDE };

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

function flip(p: Pt[]): Pt[] {
  return mirrorPts(p, MID);
}

function shape(spec: PartSpec, mirrored: boolean): { d: string; poly: Pt[] } {
  if (spec.ellipse) {
    const [cx0, cy, rx, ry] = spec.ellipse;
    const cx = mirrored ? 2 * MID - cx0 : cx0;
    return { d: ellipsePath(cx, cy, rx, ry), poly: ellipsePts(cx, cy, rx, ry) };
  }
  const { pts, corners } = parsePoints(spec.pts ?? "");
  const p = mirrored ? flip(pts) : pts;
  return { d: smoothPath(p, corners), poly: smoothPolygon(p, corners) };
}

/** The full outline from the half drawn on the screen's left. */
function fullOutline(half: string, mirrorWhole: boolean): string {
  const { pts, corners } = parsePoints(half);
  const back = flip(pts.slice(1, -1)).reverse();
  let all = [...pts, ...back];
  const cs = new Set(corners);
  if (mirrorWhole) all = flip(all);
  return smoothPath(all, cs);
}

/**
 * One view of the body. Front and back mirror every paired part onto the
 * other side; the side view is drawn whole (the right side), and the left
 * side is the whole drawing mirrored.
 */
export function buildView(key: ViewKey, facing: SideFacing = "R"): AtlasView {
  const spec = SPECS[key];
  const parts: AtlasPart[] = [];
  const isSide = key === "side";
  const mirrorWhole = isSide && facing === "L";
  // which side the screen-left copy is
  const leftSide: PainSide = key === "front" ? "R" : "L";
  let n = 0;
  const push = (s: PartSpec, mirrored: boolean, side: PainSide | null) => {
    const { d, poly } = shape(s, mirrored);
    const site = s.site ?? null;
    parts.push({
      id: `${key}-${n++}`,
      site,
      region: siteOf(site)?.region ?? null,
      side,
      kind: s.kind,
      d,
      poly,
      box: bboxOf(poly),
      center: centroid(poly),
      fiber: s.fiber == null ? null : mirrored ? 180 - s.fiber : s.fiber,
      deep: !!s.deep,
    });
  };
  for (const s of spec.parts) {
    const midline = s.mid || !!siteOf(s.site)?.midline;
    if (isSide) {
      push(s, mirrorWhole, midline ? null : facing);
    } else if (midline) {
      push(s, false, null);
    } else {
      push(s, false, leftSide);
      push(s, true, leftSide === "R" ? "L" : "R");
    }
  }
  const lines: AtlasLine[] = [];
  for (const l of spec.lines as LineSpec[]) {
    const { pts } = parsePoints(l.pts);
    const tone = l.tone ?? "groove";
    if (isSide) lines.push({ d: smoothLine(mirrorWhole ? flip(pts) : pts), tone });
    else {
      lines.push({ d: smoothLine(pts), tone });
      if (!l.mid) lines.push({ d: smoothLine(flip(pts)), tone });
    }
  }
  const head = parsePoints(spec.head);
  const headPts = mirrorWhole ? flip(head.pts) : head.pts;
  return {
    key,
    facing: isSide ? facing : null,
    silhouette: isSide ? smoothPath(mirrorWhole ? flip(parsePoints(spec.silhouette).pts) : parsePoints(spec.silhouette).pts, parsePoints(spec.silhouette).corners) : fullOutline(spec.silhouette, false),
    head: smoothPath(headPts, head.corners),
    parts,
    lines,
  };
}

const cache = new Map<string, AtlasView>();
export function atlasView(key: ViewKey, facing: SideFacing = "R"): AtlasView {
  const k = `${key}:${key === "side" ? facing : ""}`;
  let v = cache.get(k);
  if (!v) {
    v = buildView(key, facing);
    cache.set(k, v);
  }
  return v;
}

/** The parts drawn on a layer: surface hides the deep ones; deeper shows only them as tappable. */
export function layerParts(view: AtlasView, deep: boolean): AtlasPart[] {
  return view.parts.filter((p) => (deep ? true : !p.deep));
}

/** Does this view have anything on its deeper layer for the region (or anywhere)? */
export function hasDeep(view: AtlasView, region?: string | null): boolean {
  return view.parts.some((p) => p.deep && (!region || p.region === region));
}

/** A region's box on one side of a view (both sides when it's on the midline), padded. */
export function regionBox(view: AtlasView, region: string, side: PainSide | null, opts: { deep?: boolean; pad?: number } = {}): Box | null {
  const pad = opts.pad ?? 18;
  const parts = view.parts.filter((p) => p.region === region && (opts.deep || !p.deep) && (side == null || p.side == null || p.side === side));
  const b = unionBox(parts.map((p) => p.box));
  if (!b) return null;
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** The tappable part under a point (drawing coords), else the nearest within `reach`. Later parts are on top. */
export function partAt(parts: AtlasPart[], pt: Pt, reach = 0): AtlasPart | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p.site) continue;
    if (pt[0] < p.box.x || pt[0] > p.box.x + p.box.w || pt[1] < p.box.y || pt[1] > p.box.y + p.box.h) continue;
    if (insidePoly(pt, p.poly)) return p;
  }
  if (reach <= 0) return null;
  let best: AtlasPart | null = null;
  let bestD = reach;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p.site) continue;
    if (pt[0] < p.box.x - reach || pt[0] > p.box.x + p.box.w + reach || pt[1] < p.box.y - reach || pt[1] > p.box.y + p.box.h + reach) continue;
    const d = edgeDistance(pt, p.poly);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function insidePoly(pt: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance(pt: Pt, poly: Pt[]): number {
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

/** Sites drawn on a view (for "is it on this view?"). */
export function sitesOnView(view: AtlasView): Set<string> {
  return new Set(view.parts.filter((p) => p.site).map((p) => p.site!));
}
