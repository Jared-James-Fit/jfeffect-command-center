/**
 * Where it hurts, as a body: front and back side by side, tap a place to pick
 * it, tap it again to take it off. Each figure says which side is the
 * client's right. A tap just outside a small place (the neck, an elbow) still
 * lands on it (body-map.ts `regionAt`), and every place is also a button the
 * keyboard and screen readers reach by name.
 *
 * Picked places are filled; a place the athlete already reported in the last
 * six weeks carries a small dot, so a recurring spot is easy to find again.
 */
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { areaLabel, type PainSide } from "@/lib/pain/regions";
import { BACK_HEAD, HEAD, MAP_REGIONS, regionAt, shapePath, type MapRegion, type Shape } from "@/lib/pain/body-map";

/** The drawing's box, cropped to the two figures. */
const VIEW = { x: 28, y: 4, w: 344, h: 404 };

export type MapPick = { region: string; side: PainSide | null };

function centre(s: Shape): [number, number] {
  if (s.kind === "ellipse") return [s.cx, s.cy];
  if (s.kind === "rect") return [s.x + s.w / 2, s.y + s.h / 2];
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function BodyMap({
  picked,
  recent,
  onToggle,
  className,
}: {
  picked: MapPick[];
  /** Places reported in the last six weeks ("region:side"). */
  recent?: Set<string>;
  onToggle: (pick: MapPick) => void;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  // a midline place (low back) is picked whatever side its details give it
  const isPicked = (m: MapRegion) => picked.some((p) => p.region === m.region && (m.side == null || (p.side ?? null) === m.side));

  const toggle = (m: MapRegion) => {
    feedback("tap");
    onToggle({ region: m.region, side: m.side });
  };

  // a tap (not a scroll) picks what's under it, or the nearest place within reach
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const start = down.current;
    down.current = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) return;
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const hit = regionAt(pt.x, pt.y);
    if (hit) toggle(hit);
  };
  const onKey = (m: MapRegion) => (e: KeyboardEvent<SVGPathElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(m);
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      className={cn("mx-auto block h-auto w-full max-w-[340px] touch-manipulation select-none", className)}
      role="group"
      aria-label="Body map: tap where it hurts"
      data-body-map
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (down.current = null)}
    >
      {/* which way each figure faces, and whose right is where */}
      <g className="fill-muted-foreground text-[11px] font-semibold" aria-hidden>
        <text x={100} y={402} textAnchor="middle">Front</text>
        <text x={300} y={402} textAnchor="middle">Back</text>
        <text x={36} y={74} textAnchor="middle">R</text>
        <text x={164} y={74} textAnchor="middle">L</text>
        <text x={236} y={74} textAnchor="middle">L</text>
        <text x={364} y={74} textAnchor="middle">R</text>
      </g>
      <path d={shapePath(HEAD)} className="fill-muted-foreground/15" aria-hidden />
      <path d={shapePath(BACK_HEAD)} className="fill-muted-foreground/15" aria-hidden />
      {MAP_REGIONS.map((m) => {
        const on = isPicked(m);
        const label = `${areaLabel(m.region, m.side)}, ${m.view}`;
        return (
          <path
            key={m.id}
            d={shapePath(m.shape)}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={on}
            data-region={m.id}
            onKeyDown={onKey(m)}
            className={cn(
              "cursor-pointer stroke-background outline-none transition-colors duration-150 [stroke-width:2]",
              "focus-visible:stroke-foreground focus-visible:[stroke-width:2.5]",
              on ? "fill-foreground" : "fill-muted-foreground/25 hover:fill-muted-foreground/40",
            )}
          />
        );
      })}
      {/* reported before: a quiet dot, so a recurring spot is easy to find */}
      {recent &&
        MAP_REGIONS.filter((m) => recent.has(`${m.region}:${m.side ?? "-"}`) && !isPicked(m)).map((m) => {
          const [cx, cy] = centre(m.shape);
          return <circle key={`dot-${m.id}`} cx={cx} cy={cy} r={2.8} className="pointer-events-none fill-foreground/70" aria-hidden />;
        })}
    </svg>
  );
}
