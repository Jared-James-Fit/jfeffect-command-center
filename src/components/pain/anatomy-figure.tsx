/**
 * One view of the anatomical body, drawn (static SVG, no gestures: the map
 * around it zooms and pans it with a CSS transform, so a pinch never redraws
 * a path). Muscles carry a little volume and the direction their fibres run;
 * tendons and bone are ivory; a place the athlete picked is the brand red with
 * a white edge, and one they reported before carries a quiet dot.
 *
 * Always drawn on a dark ground (the pain map is a dark screen whatever the
 * theme, like an anatomy atlas), so its colours are fixed here.
 */
import { memo, useId } from "react";
import type { AtlasPart, AtlasView } from "@/lib/pain/anatomy/atlas";
import { VIEW_H, VIEW_W, type Box } from "@/lib/pain/anatomy/geometry";

export const ANATOMY_COLORS = {
  ground: "#0b0b0d",
  fascia: "#2b1d1d",
  head: "#3a302f",
  muscle: "#8c4c46",
  muscleDeep: "#b9675b",
  tendon: "#c9bba3",
  bone: "#b9ad97",
  skin: "#7a4d47",
  seam: "#1a1010",
  picked: "#e5392f",
  pickedEdge: "#ffffff",
} as const;

/** "site:side" for a place, the way the map keys picks. */
export const placeKey = (site: string, side: string | null) => `${site}:${side ?? "-"}`;

function fiberAngles(parts: AtlasPart[]): number[] {
  const set = new Set<number>();
  for (const p of parts) if (p.fiber != null) set.add(Math.round(p.fiber / 5) * 5);
  return [...set];
}

type Props = {
  view: AtlasView;
  /** Show the deeper layer: the surface fades back and only deep parts are drawn on top. */
  deep?: boolean;
  /** Picked places ("site:side"). */
  picked?: ReadonlySet<string>;
  /** Whole areas picked ("region:side"): every part of it shows, softer. */
  pickedAreas?: ReadonlySet<string>;
  /** Reported before ("site:side"). */
  recent?: ReadonlySet<string>;
  /** Only draw what's inside this box (a thumbnail): faster, and nothing off-frame. */
  box?: Box | null;
  className?: string;
  /** A part being pressed (a quick lighten before the pick). */
  pressed?: string | null;
  /** Zoomed in: joint and tendon spots show their outline (overview keeps them quiet). */
  detail?: boolean;
};

function AnatomyFigureImpl({ view, deep = false, picked, pickedAreas, recent, box, className, pressed, detail = true }: Props) {
  const uid = useId().replace(/:/g, "");
  const shade = `sh-${uid}`;
  const fib = (a: number) => `fb-${uid}-${a < 0 ? `m${-a}` : a}`;
  const vb = box ?? { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  const within = (p: AtlasPart) =>
    !box || (p.box.x < box.x + box.w && p.box.x + p.box.w > box.x && p.box.y < box.y + box.h && p.box.y + p.box.h > box.y);
  const surface = view.parts.filter((p) => !p.deep && within(p));
  const deepParts = deep ? view.parts.filter((p) => p.deep && within(p)) : [];
  const angles = fiberAngles([...surface, ...deepParts]);

  const draw = (p: AtlasPart, faded: boolean) => {
    const key = p.site ? placeKey(p.site, p.side) : null;
    const on = !!key && !!picked?.has(key);
    const area = !on && !!p.region && !!pickedAreas?.size && (pickedAreas.has(`${p.region}:${p.side ?? "-"}`) || (p.side == null && [...pickedAreas].some((k) => k.startsWith(`${p.region}:`))));
    const isPressed = !!pressed && pressed === p.id;
    const c = ANATOMY_COLORS;
    const base =
      on ? c.picked
      : p.kind === "muscle" ? (p.deep ? c.muscleDeep : c.muscle)
      : p.kind === "tendon" ? c.tendon
      : p.kind === "bone" ? c.bone
      : p.kind === "skin" ? c.skin
      : "transparent";
    const joint = p.kind === "joint" && !on;
    return (
      <g
        key={p.id}
        data-part={p.id}
        data-site={p.site ?? undefined}
        data-side={p.side ?? undefined}
        data-picked={on ? "" : area ? "area" : undefined}
        opacity={faded ? 0.12 : 1}
        style={isPressed ? { filter: "brightness(1.35)" } : undefined}
      >
        <path
          d={p.d}
          fill={area ? c.picked : joint ? "rgba(217,204,182,0.08)" : base}
          stroke={on ? c.pickedEdge : joint ? (detail ? "rgba(217,204,182,0.5)" : "transparent") : p.deep ? "rgba(255,226,214,0.55)" : c.seam}
          strokeWidth={on ? 1.1 : joint ? 0.7 : p.deep ? 0.6 : 0.8}
          strokeDasharray={joint ? "1.6 1.4" : undefined}
          fillOpacity={on ? 1 : area ? 0.55 : p.kind === "tendon" ? 0.72 : p.kind === "bone" ? 0.6 : joint && !detail ? 0 : 1}
        />
        {(p.kind === "muscle" || p.kind === "skin") && <path d={p.d} fill={`url(#${shade})`} pointerEvents="none" />}
        {p.fiber != null && <path d={p.d} fill={`url(#${fib(Math.round(p.fiber / 5) * 5)})`} opacity={on ? 0.55 : 1} pointerEvents="none" />}
      </g>
    );
  };

  const dots = recent
    ? view.parts.filter((p) => p.site && (!p.deep || deep) && within(p) && recent.has(placeKey(p.site, p.side)) && !picked?.has(placeKey(p.site, p.side)))
    : [];
  const dotSeen = new Set<string>();

  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      data-anatomy={view.key}
      data-deep={deep ? "" : undefined}
    >
      <defs>
        <radialGradient id={shade} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
        {angles.map((a) => (
          <pattern key={a} id={fib(a)} width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform={`rotate(${a})`}>
            <line x1="0" y1="0.6" x2="2.6" y2="0.6" stroke="#000" strokeOpacity="0.24" strokeWidth="0.55" />
            <line x1="0" y1="1.9" x2="2.6" y2="1.9" stroke="#fff" strokeOpacity="0.07" strokeWidth="0.4" />
          </pattern>
        ))}
      </defs>
      <path d={view.silhouette} fill={ANATOMY_COLORS.fascia} />
      <path d={view.head} fill={ANATOMY_COLORS.head} />
      <path d={view.head} fill={`url(#${shade})`} />
      <g data-layer="surface">{surface.map((p) => draw(p, deep))}</g>
      <g pointerEvents="none">
        {view.lines.map((l, i) => (
          <path
            key={i}
            d={l.d}
            fill="none"
            stroke={l.tone === "tendon" ? "rgba(217,204,182,0.55)" : "rgba(10,6,6,0.6)"}
            strokeWidth={l.tone === "tendon" ? 1.1 : 0.9}
            strokeLinecap="round"
            opacity={deep ? 0.2 : 1}
          />
        ))}
      </g>
      {deep && <g data-layer="deep">{deepParts.map((p) => draw(p, false))}</g>}
      <g pointerEvents="none">
        {dots.map((p) => {
          const k = placeKey(p.site!, p.side);
          if (dotSeen.has(k)) return null;
          dotSeen.add(k);
          return <circle key={`dot-${p.id}`} cx={p.center[0]} cy={p.center[1]} r={2.4} fill="#fff" fillOpacity={0.85} stroke="#000" strokeOpacity={0.4} strokeWidth={0.6} />;
        })}
      </g>
    </svg>
  );
}

export const AnatomyFigure = memo(AnatomyFigureImpl);
