/**
 * Where visits come from, approximately: one bubble per city (sized by visits, a ring when someone
 * is in the app there now) on a light or dark map. Interactive with no map library: drag to move,
 * the buttons or a double-click to zoom, a bubble to read its numbers. Tiles are CARTO's basemaps over
 * OpenStreetMap data (credited on the map); if they can't load, the bubbles still show on a plain
 * grid.
 *
 * Places are the host's IP country, placed at the device's time zone's main city (pulse.server.ts);
 * nothing here can show a person's location, and no bubble names anyone.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Minus, Plus, LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";

export type MapPlace = {
  key: string;
  label: string;
  lat: number | null;
  lng: number | null;
  people: number;
  visitors: number;
  sessions: number;
  live: number;
  /** registered people placed here, and paying clients (Analytics → Audience & Geography) */
  registered?: number;
  paying?: number;
};

export type MapMetric = "sessions" | "visitors" | "people" | "registered" | "paying";

const METRIC_WORD: Record<MapMetric, [string, string]> = {
  sessions: ["visit", "visits"],
  visitors: ["visitor", "visitors"],
  people: ["member or client", "members or clients"],
  registered: ["registered person", "registered people"],
  paying: ["paying client", "paying clients"],
};

function metricOf(p: MapPlace, m: MapMetric): number {
  return Number((p as any)[m] ?? 0) || 0;
}

const TILE = 256;
const MIN_Z = 1;
const MAX_Z = 11;

function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const s = TILE * 2 ** z;
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

function unproject(x: number, y: number, z: number): { lat: number; lng: number } {
  const s = TILE * 2 ** z;
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}

/** A view that fits every point with room around it (pure; exported for the test). */
export function fitView(points: { lat: number; lng: number }[], width: number, height: number): { lat: number; lng: number; z: number } {
  if (!points.length) return { lat: 50, lng: -97, z: 3 };
  for (let z = MAX_Z - 2; z >= MIN_Z; z--) {
    const ps = points.map((p) => project(p.lat, p.lng, z));
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w <= width * 0.7 && h <= height * 0.7) {
      const c = unproject((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, z);
      return { ...c, z: points.length === 1 ? Math.min(z, 8) : z };
    }
  }
  return { lat: 30, lng: -40, z: MIN_Z };
}

function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function PlaceMap({
  places,
  height = 340,
  metric = "sessions",
  heat = false,
}: {
  places: MapPlace[];
  height?: number;
  /** what sizes a bubble (and weighs the heat) */
  metric?: MapMetric;
  /** a density heatmap instead of bubbles */
  heat?: boolean;
}) {
  const pts = useMemo(
    () => (places.filter((p) => p.lat != null && p.lng != null) as (MapPlace & { lat: number; lng: number })[]).filter((p) => metric === "sessions" || metricOf(p, metric) > 0),
    [places, metric],
  );
  const heatRef = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [view, setView] = useState<{ lat: number; lng: number; z: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(0);
  const [dark, setDark] = useState(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);

  useEffect(() => {
    setDark(isDark());
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 640));
    ro.observe(el);
    setWidth(el.clientWidth || 640);
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  const fitted = useMemo(() => fitView(pts, width, height), [pts, width, height]);
  const v = view ?? fitted;
  const center = project(v.lat, v.lng, v.z);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const maxSessions = Math.max(1, ...pts.map((p) => metricOf(p, metric)));

  // the heat layer: one soft disc per place, weighted by the metric, drawn on a canvas the map's size
  useEffect(() => {
    const cv = heatRef.current;
    if (!cv) return;
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!heat) return;
    const radius = 18 + v.z * 3;
    for (const p of pts) {
      const pos = project(p.lat, p.lng, v.z);
      const x = pos.x - left;
      const y = pos.y - top;
      if (x < -radius || y < -radius || x > width + radius || y > height + radius) continue;
      const w = Math.sqrt(metricOf(p, metric) / maxSessions);
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius * (0.6 + w));
      g.addColorStop(0, `rgba(235, 104, 52, ${0.25 + 0.55 * w})`);
      g.addColorStop(0.5, `rgba(235, 104, 52, ${0.12 + 0.25 * w})`);
      g.addColorStop(1, "rgba(235, 104, 52, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.6 + w), 0, Math.PI * 2);
      ctx.fill();
    }
  }, [heat, pts, metric, maxSessions, width, height, left, top, v.z]);

  const tiles = useMemo(() => {
    const out: { key: string; x: number; y: number; url: string }[] = [];
    const n = 2 ** v.z;
    const x0 = Math.floor(left / TILE);
    const y0 = Math.max(0, Math.floor(top / TILE));
    const x1 = Math.floor((left + width) / TILE);
    const y1 = Math.min(n - 1, Math.floor((top + height) / TILE));
    const style = dark ? "dark_all" : "light_all";
    const subs = ["a", "b", "c", "d"];
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        out.push({
          key: `${v.z}/${tx}/${ty}`,
          x: tx * TILE - left,
          y: ty * TILE - top,
          url: `https://${subs[(wx + ty) % 4]}.basemaps.cartocdn.com/${style}/${v.z}/${wx}/${ty}@2x.png`,
        });
      }
    return out;
  }, [v.z, left, top, width, height, dark]);

  const zoomBy = (d: number, at?: { x: number; y: number }) => {
    const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z + d));
    if (z === v.z) return;
    const focus = at ?? { x: width / 2, y: height / 2 };
    const ll = unproject(left + focus.x, top + focus.y, v.z);
    const p = project(ll.lat, ll.lng, z);
    const c = unproject(p.x - focus.x + width / 2, p.y - focus.y + height / 2, z);
    setView({ ...c, z });
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: center.x, cy: center.y, moved: false };
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const c = unproject(d.cx - dx, d.cy - dy, v.z);
    setView({ ...c, z: v.z });
  };
  const onUp = () => {
    if (drag.current && !drag.current.moved) setPicked(null);
    drag.current = null;
  };

  const pickedPlace = pts.find((p) => p.key === picked) ?? null;

  return (
    <div className="relative">
      <div
        ref={box}
        className={cn("relative touch-none select-none overflow-hidden rounded-xl border", dark ? "bg-[#1b1d21]" : "bg-[#eef0f2]")}
        style={{ height }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const r = box.current!.getBoundingClientRect();
          zoomBy(1, { x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        role="application"
        aria-label="Map of approximate visit locations. Drag to move, double-click or use the buttons to zoom."
      >
        {tilesFailed < 6 &&
          tiles.map((t) => (
            <img
              key={t.key}
              src={t.url}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
                setTilesFailed((n) => n + 1);
              }}
              className="pointer-events-none absolute"
              style={{ left: t.x, top: t.y, width: TILE, height: TILE }}
            />
          ))}
        <canvas ref={heatRef} className="pointer-events-none absolute inset-0" style={{ width, height }} aria-hidden />
        {pts.map((p) => {
          const pos = project(p.lat, p.lng, v.z);
          const x = pos.x - left;
          const y = pos.y - top;
          if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return null;
          const r = heat ? 5 : 7 + Math.sqrt(metricOf(p, metric) / maxSessions) * 17;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPicked(p.key === picked ? null : p.key)}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              style={{ left: x, top: y, width: r * 2, height: r * 2 }}
              aria-label={`${p.label}: ${metricOf(p, metric)} ${METRIC_WORD[metric][metricOf(p, metric) === 1 ? 0 : 1]}${p.live ? `, ${p.live} in the app now` : ""}`}
            >
              {p.live > 0 && <span className="absolute inset-[-5px] animate-ping rounded-full border-2 border-[var(--viz-3)] motion-reduce:animate-none" aria-hidden />}
              <span
                className="absolute inset-0 rounded-full border-2 border-card"
                style={{ background: "var(--viz-1)", opacity: p.key === picked ? 1 : 0.82 }}
                aria-hidden
              />
            </button>
          );
        })}
        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <button type="button" onClick={() => zoomBy(1)} className="grid h-9 w-9 place-items-center hover:bg-muted" aria-label="Zoom in">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => zoomBy(-1)} className="grid h-9 w-9 place-items-center border-t hover:bg-muted" aria-label="Zoom out">
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setView(null)} className="grid h-9 w-9 place-items-center border-t hover:bg-muted" aria-label="Fit every place">
            <LocateFixed className="h-4 w-4" />
          </button>
        </div>
        {pickedPlace && (
          <div className="absolute bottom-8 left-2 max-w-[16rem] rounded-lg border bg-popover p-3 text-[12px] text-popover-foreground shadow-md">
            <div className="text-[13px] font-semibold">{pickedPlace.label}</div>
            <div className="mt-1 space-y-0.5 text-muted-foreground">
              <div>{pickedPlace.sessions} visit{pickedPlace.sessions === 1 ? "" : "s"}</div>
              {pickedPlace.people > 0 && <div>{pickedPlace.people} member{pickedPlace.people === 1 ? "" : "s"} or client{pickedPlace.people === 1 ? "" : "s"}</div>}
              {pickedPlace.visitors > 0 && <div>{pickedPlace.visitors} website visitor{pickedPlace.visitors === 1 ? "" : "s"}</div>}
              {(pickedPlace.registered ?? 0) > 0 && <div>{pickedPlace.registered} new account{pickedPlace.registered === 1 ? "" : "s"}</div>}
              {(pickedPlace.paying ?? 0) > 0 && <div>{pickedPlace.paying} paying client{pickedPlace.paying === 1 ? "" : "s"}</div>}
              {pickedPlace.live > 0 && <div className="font-medium text-foreground">{pickedPlace.live} in the app now</div>}
            </div>
          </div>
        )}
        <div className="absolute bottom-0 right-0 rounded-tl-md bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          © OpenStreetMap contributors © CARTO
        </div>
        {!pts.length && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-muted-foreground">
            No placed visits yet. Places appear as people open the app.
          </div>
        )}
      </div>
    </div>
  );
}
