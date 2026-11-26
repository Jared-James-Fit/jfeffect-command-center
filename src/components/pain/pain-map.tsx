/**
 * "Select area": the anatomical body map, full screen over the workout review
 * (Nov 21 2026; a picker since Nov 26 2026).
 *
 * Front, back and side views of the body, every muscle, tendon and joint area
 * drawn (atlas-data.ts). A tap on the body zooms into that area; zoomed in, a
 * tap (or a tap on a label) picks the exact spot, or "The whole knee" when
 * they're not sure exactly where. Pinch and drag zoom anywhere; the deeper
 * layer shows the rotator cuff, rhomboids, QL, piriformis and the like; the
 * list finds any spot by name.
 *
 * Picking a spot hands it back and closes: how bad, which side and the rest
 * are asked on the review's own list (pain-entries.tsx), the same for a place
 * said, typed or picked here. Opened from a place's "Change spot", it opens
 * on that place and the pick moves it. The map shows where they feel it,
 * never what's wrong: nothing here names an injury.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, Layers, List, Search, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { noAutofill } from "@/lib/no-autofill";
import { AnatomyFigure, placeKey } from "@/components/pain/anatomy-figure";
import { atlasView, hasDeep, partAt, regionBox, type AtlasPart, type SideFacing, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { DETAIL_SCALE, IDENTITY, centerOn, clampXf, fitView, frameBox, toDrawing, toScreen, zoomAt, type Size, type Xf } from "@/lib/pain/anatomy/stage";
import { PAIN_REGIONS, areaLabel, regionOf, type PainSide } from "@/lib/pain/regions";
import { PAIN_SITES, searchSites, siteLabel, siteOf } from "@/lib/pain/sites";
import { placeLabel } from "@/lib/pain/report";
import { type PainEntry } from "@/lib/pain/history";
import { pickScore, recentSites, type PainPick } from "@/lib/pain/picks";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { viewForPlace, partForPlace } from "@/lib/pain/anatomy/place-view";

export type PainMapContext = {
  today: string;
  entries: PainEntry[];
  exercises: { id: string | null; name: string }[];
  feedbackId: string | null;
};

/** The four ways round: a side view shows one side of the body at a time. */
const VIEWS: { v: ViewKey; facing: SideFacing; key: string; label: string }[] = [
  { v: "front", facing: "R", key: "front", label: "Front" },
  { v: "back", facing: "R", key: "back", label: "Back" },
  { v: "side", facing: "R", key: "side-R", label: "Right side" },
  { v: "side", facing: "L", key: "side-L", label: "Left side" },
];

export { viewForPlace, partForPlace };

// ── the list ────────────────────────────────────────────────────────────

function PlaceSearch({ onPick }: { onPick: (place: { region: string; side: PainSide | null; site: string | null }) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => searchSites(q), [q]);
  const byRegion = useMemo(() => {
    if (q.trim()) return null;
    return PAIN_REGIONS.filter((r) => r.key !== "other").map((r) => ({ region: r, sites: PAIN_SITES.filter((s) => s.region === r.key) }));
  }, [q]);
  const sideButtons = (label: string, region: string, site: string | null, sided: boolean, anat?: string | null) =>
    sided ? (
      <span className="flex shrink-0 gap-1.5">
        {(["L", "R"] as PainSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick({ region, side: s, site })}
            className="inline-flex h-10 min-w-[3.25rem] items-center justify-center rounded-lg bg-muted px-2 text-[13px] font-semibold hover:bg-muted-foreground/25"
            aria-label={`${s === "L" ? "Left" : "Right"} ${label.toLowerCase()}${anat ? `, ${anat}` : ""}`}
          >
            {s === "L" ? "Left" : "Right"}
          </button>
        ))}
      </span>
    ) : (
      <button type="button" onClick={() => onPick({ region, side: null, site })} className="inline-flex h-10 min-w-[4rem] items-center justify-center rounded-lg bg-muted px-3 text-[13px] font-semibold hover:bg-muted-foreground/25" aria-label={`Pick ${label.toLowerCase()}${anat ? `, ${anat}` : ""}`}>
        Pick
      </button>
    );
  const row = (s: (typeof PAIN_SITES)[number]) => (
    <div key={s.key} className="flex min-h-14 items-center gap-3 border-b border-white/[0.06] py-2" data-pain-list-site={s.key}>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-tight">{s.label}</p>
        {s.anat && <p className="truncate text-[12px] text-muted-foreground">{s.anat}{q.trim() ? ` · ${regionOf(s.region)?.label}` : ""}</p>}
      </div>
      {sideButtons(s.label, s.region, s.key, !s.midline, s.anat)}
    </div>
  );
  return (
    <div className="flex h-full flex-col" data-pain-list>
      <div className="px-4 pb-2 pt-1">
        <label className="flex h-11 items-center gap-2 rounded-lg bg-white/[0.07] px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search: knee, lats, rotator cuff…"
            aria-label="Search the body"
            {...noAutofill("pain-search")}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear the search" className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {byRegion
          ? byRegion.map(({ region: r, sites }) => (
              <section key={r.key} className="pt-3">
                <div className="flex min-h-12 items-center gap-3 border-b border-white/[0.06] pb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</p>
                    <p className="text-[12px] text-muted-foreground/80">Not sure exactly? Pick the whole area</p>
                  </div>
                  {sideButtons(r.label, r.key, null, r.sided || !!r.lateral)}
                </div>
                {sites.map(row)}
              </section>
            ))
          : results.length
            ? results.map(row)
            : (
              <div className="space-y-3 py-8 text-center text-[14px] text-muted-foreground">
                <p>Nothing called that. Try another word, or pick the closest area.</p>
                <button type="button" onClick={() => onPick({ region: "other", side: null, site: null })} className="inline-flex h-10 items-center rounded-lg bg-muted px-4 font-semibold text-foreground">
                  Somewhere else: describe it
                </button>
              </div>
            )}
      </div>
    </div>
  );
}

// ── the map ─────────────────────────────────────────────────────────────

type Gesture = {
  pointers: Map<number, { x: number; y: number }>;
  start: { x: number; y: number; t: number } | null;
  moved: boolean;
  pinched: boolean;
  /** The first finger landed on a label or a tool: a still tap is that button's, not the drawing's. */
  onButton: boolean;
  xf0: Xf;
  dist0: number;
  mid0: { x: number; y: number };
};

/** How much of the stage the "In view" list takes while zoomed in (the map frames the area above it). */
const PANEL_SHARE = 0.36;
/** The notch, or the notch and iOS's blur band where it's added (styles.css --app-safe-top); never less than the notch. */
const SAFE_TOP = "max(env(safe-area-inset-top, 0px), var(--app-safe-top, 0px))";
const PANEL_MIN = 168;
/** Structures listed (and numbered on the drawing) at most. */
const IN_VIEW_MAX = 10;

export function PainMap({
  open,
  onOpenChange,
  picks,
  ctx,
  focusUid,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's reported already (lit on the body). */
  picks: PainPick[];
  ctx: PainMapContext | null;
  /** Open on this place ("Change spot"): the pick moves it. */
  focusUid?: string | null;
  /** A spot or a whole area was picked: the map closes. */
  onPick: (place: { region: string; side: PainSide | null; site: string | null }) => void;
}) {
  const [viewKey, setViewKey] = useState<ViewKey>("front");
  const [facing, setFacing] = useState<SideFacing>("R");
  const [deep, setDeep] = useState(false);
  const [mode, setMode] = useState<"map" | "list">("map");
  const [xf, setXf] = useState<Xf>(IDENTITY);
  const [animate, setAnimate] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const [focus, setFocus] = useState<{ region: string; side: PainSide | null } | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [size, setSize] = useState<Size>({ w: 375, h: 560 });
  // the stage is in a portal that mounts after the dialog opens: its size is
  // read when the element itself arrives, never only on open
  const stage = useRef<HTMLDivElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    stage.current = el;
    setStageEl(el);
  }, []);
  const g = useRef<Gesture>({ pointers: new Map(), start: null, moved: false, pinched: false, onButton: false, xf0: IDENTITY, dist0: 1, mid0: { x: 0, y: 0 } });
  const latest = useRef({ xf, picks });
  latest.current = { xf, picks };

  const view = atlasView(viewKey, facing);
  const fit = useMemo(() => fitView(size), [size]);
  // zoomed in on an area (tapped, or pinched in): the spots there are listed under the drawing
  const detail = xf.s >= DETAIL_SCALE || !!focus;
  const panelH = detail && mode === "map" ? Math.max(PANEL_MIN, Math.round(size.h * PANEL_SHARE)) : 0;
  const vis = useMemo(() => ({ top: 0, bottom: panelH }), [panelH]);

  const picked = useMemo(() => new Set(picks.filter((p) => p.site).map((p) => placeKey(p.site!, siteOf(p.site)?.midline ? null : p.side ?? null))), [picks]);
  const pickedAreas = useMemo(() => new Set(picks.filter((p) => !p.site && p.region !== "other").map((p) => `${p.region}:${p.side ?? "-"}`)), [picks]);
  const recent = useMemo(() => (ctx ? recentSites(ctx.entries, ctx.feedbackId) : new Set<string>()), [ctx]);

  useLayoutEffect(() => {
    const el = stageEl;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageEl]);

  // A pinch anywhere on the map is the map's (the stage zooms the body), never the
  // page's: iOS would zoom the whole app under the dialog. Two fingers on the
  // header, the details or the list do nothing.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = contentEl;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    };
    el.addEventListener("gesturestart", stop);
    el.addEventListener("gesturechange", stop);
    el.addEventListener("touchmove", twoFingers, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", stop);
      el.removeEventListener("gesturechange", stop);
      el.removeEventListener("touchmove", twoFingers);
    };
  }, [contentEl]);

  // the keyboard: the dialog is the visible part of the screen while it's up
  const vv = useVisualViewportBox(open);
  const kb = !!vv?.keyboard;

  const go = useCallback((next: Xf, anim = true) => {
    setAnimate(anim);
    setXf(next);
  }, []);

  const reset = useCallback(() => {
    setFocus(null);
    setDeep(false);
    go(IDENTITY);
  }, [go]);

  // each open starts on the whole body, or on the place being moved
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode("map");
      setPressed(null);
      const p = focusUid ? latest.current.picks.find((x) => x.uid === focusUid) : null;
      if (p && p.region !== "other") {
        const where = viewForPlace(p.site, p.region, p.side ?? null);
        setViewKey(where.view);
        setFacing(where.facing);
        setDeep(!!siteOf(p.site)?.deep);
        setFocus({ region: p.region, side: siteOf(p.site)?.midline ? null : p.side ?? null });
      } else {
        setFocus(null);
        setDeep(false);
      }
      setXf(IDENTITY);
      setAnimate(false);
    }
    wasOpen.current = open;
  }, [open, focusUid]);

  // frame the focused area (after a view switch, a layer switch or the stage settling)
  const framedFor = useRef<string>("");
  useEffect(() => {
    if (!open || !focus) {
      framedFor.current = "";
      return;
    }
    const key = `${viewKey}:${facing}:${focus.region}:${focus.side}:${deep}:${size.w}x${size.h}:${vis.bottom}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    const box = regionBox(view, focus.region, focus.side, { deep, pad: 16 });
    if (!box) return;
    const p = focusUid ? latest.current.picks.find((x) => x.uid === focusUid) : null;
    const part = p && p.region === focus.region ? partForPlace(view, p.site, p.region, p.side ?? null) : null;
    const framed = frameBox(box, size, fit, vis, 0.86);
    go(part ? centerOn(part.center, framed, size, fit, vis) : framed);
  }, [open, focus, viewKey, facing, deep, size, fit, vis, view, focusUid, go]);

  const focusRegion = (region: string, side: PainSide | null) => {
    const r = regionOf(region);
    const s = r && (r.sided || r.lateral) ? side : null;
    feedback("tap");
    setFocus({ region, side: r?.sided ? s : side });
  };

  // a spot or a whole area: back to the review with it (how bad and the rest are asked there)
  const openPlace = (place: { region: string; side: PainSide | null; site: string | null }, _part?: AtlasPart | null) => {
    setPressed(null);
    onPick(place);
  };

  const layer = useMemo(() => view.parts.filter((p) => (deep ? p.deep : !p.deep)), [view, deep]);

  const tap = (sx: number, sy: number) => {
    const pt = toDrawing(sx, sy, fit, xf);
    const reach = 14 / (fit.k * xf.s);
    const hit = partAt(layer, pt, reach);
    if (!hit?.site || !hit.region) return;
    if (!detail) {
      focusRegion(hit.region, hit.side);
      return;
    }
    openPlace({ region: hit.region, side: hit.side, site: hit.site }, hit);
  };

  // gestures: one finger pans (zoomed in), two pinch, a still tap picks
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    const p = local(e);
    // a finger on a label or a tool still counts toward a pinch or a pan, but
    // isn't captured, so lifting it still clicks that button
    const onButton = !!(e.target as Element | null)?.closest?.("button");
    if (!onButton) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    s.pointers.set(e.pointerId, p);
    if (s.pointers.size === 1) {
      s.start = { ...p, t: performance.now() };
      s.moved = false;
      s.pinched = false;
      s.onButton = onButton;
      s.xf0 = latest.current.xf;
      // a quick lighten on what's under the finger
      const hit = onButton ? null : partAt(layer, toDrawing(p.x, p.y, fit, latest.current.xf), 10 / (fit.k * latest.current.xf.s));
      setPressed(hit?.id ?? null);
    } else if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()];
      s.pinched = true;
      s.dist0 = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      s.mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      s.xf0 = latest.current.xf;
      setPressed(null);
      setGesturing(true);
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s.pointers.has(e.pointerId)) return;
    const p = local(e);
    s.pointers.set(e.pointerId, p);
    if (s.pointers.size >= 2) {
      const [a, b] = [...s.pointers.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = s.xf0.s * (dist / s.dist0);
      const z = zoomAt(s.xf0, scale, [s.mid0.x, s.mid0.y]);
      go(clampXf({ ...z, tx: z.tx + (mid.x - s.mid0.x), ty: z.ty + (mid.y - s.mid0.y) }, size, fit, vis), false);
      return;
    }
    if (!s.start) return;
    const dx = p.x - s.start.x;
    const dy = p.y - s.start.y;
    if (!s.moved && Math.hypot(dx, dy) > 8) {
      s.moved = true;
      setPressed(null);
      if (s.xf0.s > 1.01) setGesturing(true);
    }
    if (s.moved && s.xf0.s > 1.01) go(clampXf({ s: s.xf0.s, tx: s.xf0.tx + dx, ty: s.xf0.ty + dy }, size, fit, vis), false);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    const p = local(e);
    const wasTap = s.pointers.size === 1 && !s.pinched && !s.moved && !!s.start && performance.now() - s.start.t < 600;
    s.pointers.delete(e.pointerId);
    if (s.pointers.size === 0) {
      setGesturing(false);
      setPressed(null);
      s.start = null;
      if (s.pinched && latest.current.xf.s < 1.05) reset();
      if (wasTap && !s.onButton) tap(p.x, p.y);
    } else if (s.pointers.size === 1) {
      // one finger left after a pinch: carry on panning from here
      const [rest] = [...s.pointers.values()];
      s.start = { ...rest, t: 0 };
      s.moved = true;
      s.xf0 = latest.current.xf;
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const p = local(e);
    go(clampXf(zoomAt(xf, xf.s * Math.exp(-e.deltaY * 0.0018), [p.x, p.y]), size, fit, vis), false);
  };

  // what's in view, zoomed in: numbered on the drawing, named in the list under it
  const inView = useMemo(() => {
    if (!detail || mode !== "map") return [];
    const seen = new Map<string, AtlasPart>();
    for (const p of layer) {
      if (!p.site) continue;
      const k = placeKey(p.site, p.side);
      const prev = seen.get(k);
      if (!prev || p.box.w * p.box.h > prev.box.w * prev.box.h) seen.set(k, p);
    }
    const visibleH = size.h - panelH;
    const anchors: { part: AtlasPart; sx: number; sy: number; rank: number }[] = [];
    for (const p of seen.values()) {
      const [sx, sy] = toScreen(p.center, fit, xf);
      if (sx < 10 || sx > size.w - 10 || sy < 10 || sy > visibleH - 10) continue;
      const inFocus = !!focus && p.region === focus.region && (focus.side == null || p.side == null || p.side === focus.side);
      const d = Math.hypot(sx - size.w / 2, sy - visibleH / 2);
      anchors.push({ part: p, sx, sy, rank: (inFocus ? 0 : 10_000) + d });
    }
    anchors.sort((a, b) => a.rank - b.rank);
    const keep = anchors.slice(0, IN_VIEW_MAX);
    // both sides of one structure in view: each says which
    const count = new Map<string, number>();
    for (const a of keep) count.set(a.part.site!, (count.get(a.part.site!) ?? 0) + 1);
    return keep.map((a, i) => ({ ...a, n: i + 1, sideTag: (count.get(a.part.site!) ?? 0) > 1 ? a.part.side : null }));
  }, [detail, mode, layer, size, panelH, fit, xf, focus]);

  const focusLabel = focus ? areaLabel(focus.region, focus.side) : null;
  const deepHere = focus ? hasDeep(view, focus.region) : false;
  const focusRegionDef = focus ? regionOf(focus.region) : null;

  const close = () => onOpenChange(false);
  const back = () => {
    if (mode !== "map") return setMode("map");
    if (focus || xf.s > 1.01) return reset();
    close();
  };
  const switchView = (v: ViewKey, f: SideFacing) => {
    if (v === viewKey && (v !== "side" || f === facing)) return;
    feedback("tap");
    setViewKey(v);
    setFacing(f);
    setDeep(false);
    // stay on the same area when the new view has it (on a side view, that side of it)
    if (focus) {
      const side = v === "side" && focus.side ? f : focus.side;
      const nv = atlasView(v, f);
      if (!regionBox(nv, focus.region, side)) {
        setFocus(null);
        go(IDENTITY, false);
      } else if (side !== focus.side) setFocus({ ...focus, side });
    } else go(IDENTITY, false);
  };
  const otherSide = () => {
    if (!focus?.side) return;
    feedback("tap");
    const next: PainSide = focus.side === "L" ? "R" : "L";
    if (viewKey === "side") setFacing(next);
    setFocus({ region: focus.region, side: next });
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogPrimitive.Portal>
        {/* Radix puts the scroll lock on the overlay. Without one the review sheet
            underneath stays the active lock and cancels every swipe on the map
            (the list couldn't scroll). */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[#0b0b0d]" />
        <DialogPrimitive.Content
          ref={setContentEl}
          className="dark fixed inset-x-0 z-[90] flex flex-col bg-[#0b0b0d] text-foreground outline-none"
          // typing in the list's search: the dialog ends at the keyboard, so the whole list scrolls into view
          // below the notch and, on a home-screen app added before Nov 13 2026, below the band iOS blurs (--app-safe-top)
          style={kb && vv ? { top: vv.top, height: vv.height, paddingTop: SAFE_TOP } : { top: 0, bottom: 0, paddingTop: SAFE_TOP }}
          data-pain-keyboard={kb ? "up" : undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            back();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          aria-describedby={undefined}
          data-pain-map
          data-pain-view={viewKey}
          data-pain-zoomed={detail ? "" : undefined}
        >
          <DialogPrimitive.Title className="sr-only">Where does it hurt?</DialogPrimitive.Title>
          {/* top bar */}
          <div className="flex h-14 shrink-0 items-center gap-1 px-2">
            <button type="button" onClick={back} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label={mode !== "map" ? "Back to the body" : focus || xf.s > 1.01 ? "Whole body" : "Back to your report"} data-pain-back>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-[17px] font-semibold leading-tight" data-pain-title>{mode === "list" ? "Find it by name" : focusLabel ?? (focusUid ? "Move it to" : "Where does it hurt?")}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {mode === "list" ? "Plain names, with the anatomy beside them" : detail ? "Tap the exact spot, or pick it below" : "Tap the area to zoom in"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMode(mode === "map" ? "list" : "map")}
              className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10", mode === "list" && "bg-white/10")}
              aria-label={mode !== "map" ? "Back to the body map" : "Find it by name"}
              aria-pressed={mode === "list"}
              data-pain-list-toggle
            >
              {mode !== "map" ? <X className="h-5 w-5" /> : <List className="h-5 w-5" />}
            </button>
          </div>

          {mode === "map" && (
            <div className="flex shrink-0 justify-center px-4 pb-2">
              <div className="grid w-full max-w-sm grid-cols-4 rounded-lg bg-white/[0.07] p-0.5" role="group" aria-label="View">
                {VIEWS.map((o) => {
                  const on = viewKey === o.v && (o.v !== "side" || facing === o.facing);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => switchView(o.v, o.facing)}
                      aria-pressed={on}
                      className={cn("h-10 whitespace-nowrap rounded-md px-1 text-[13px] font-semibold transition-colors", on ? "bg-white/[0.16] text-foreground" : "text-muted-foreground")}
                      data-pain-view-tab={o.key}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {mode === "list" ? (
              <PlaceSearch
                onPick={(place) => {
                  feedback("tap");
                  onPick(place);
                }}
              />
            ) : (
              <div
                ref={stageRef}
                className="absolute inset-0 touch-none select-none overflow-hidden"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onWheel={onWheel}
                data-pain-stage
              >
                <div
                  className="absolute left-0 top-0 h-full w-full origin-top-left will-change-transform"
                  style={{
                    transform: `translate3d(${xf.tx}px, ${xf.ty}px, 0) scale(${xf.s})`,
                    transition: animate ? "transform 340ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
                  }}
                  onTransitionEnd={() => setAnimate(false)}
                >
                  <AnatomyFigure
                    view={view}
                    deep={deep}
                    picked={picked}
                    pickedAreas={pickedAreas}
                    recent={recent}
                    pressed={pressed}
                    detail={detail}
                    className="h-full w-full"
                  />
                </div>

                {/* which side is which */}
                {!detail && viewKey !== "side" && (
                  <div className="pointer-events-none absolute inset-x-0 top-[14%] flex justify-between px-5 text-[12px] font-semibold text-muted-foreground" aria-hidden>
                    <span>{viewKey === "front" ? "Right" : "Left"}</span>
                    <span>{viewKey === "front" ? "Left" : "Right"}</span>
                  </div>
                )}

                {/* what's in view, numbered (the list under the drawing names them) */}
                {inView.length > 0 && !animate && !gesturing && (
                  <div className="pointer-events-none absolute inset-0" aria-hidden data-pain-markers>
                    {inView.map((c) => {
                      const on = picked.has(placeKey(c.part.site!, c.part.side));
                      return (
                        <span
                          key={c.part.id}
                          className={cn(
                            "absolute flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums shadow-[0_1px_4px_rgba(0,0,0,0.6)]",
                            on ? "bg-primary text-primary-foreground" : pressed === c.part.id ? "bg-white text-black ring-2 ring-white/60" : "bg-white/90 text-black",
                          )}
                          style={{ left: c.sx - 10, top: c.sy - 10 }}
                          data-pain-marker={c.part.site!}
                        >
                          {c.n}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* the deeper layer, where this area has one */}
                {(deepHere || deep) && (
                  <div className="absolute right-3 top-2">
                    <button
                      type="button"
                      onClick={() => {
                        feedback("tap");
                        setDeep((d) => !d);
                      }}
                      aria-pressed={deep}
                      className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold", deep ? "bg-white text-black" : "bg-black/70 text-white ring-1 ring-white/15")}
                      data-pain-deep
                    >
                      <Layers className="h-3.5 w-3.5" aria-hidden /> {deep ? "Deeper" : "Show deeper"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* zoomed in: the spots in view, plain names first, the anatomy under them */}
            {panelH > 0 && (
              <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col border-t border-white/10 bg-[#0b0b0d]" style={{ height: panelH }} data-pain-in-view>
                <div className="flex shrink-0 items-center gap-2 px-4 pb-1.5 pt-3">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{focus ? "Where exactly?" : "In view"}</p>
                  {focus && focusRegionDef?.sided && (
                    <div className="grid grid-cols-2 rounded-lg bg-white/[0.07] p-0.5" role="radiogroup" aria-label="Which side" data-pain-focus-side>
                      {(["L", "R"] as PainSide[]).map((side) => {
                        const on = focus.side === side;
                        return (
                          <button
                            key={side}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => !on && otherSide()}
                            className={cn("h-8 rounded-md px-3 text-[13px] font-semibold", on ? "bg-white/[0.16] text-foreground" : "text-muted-foreground")}
                          >
                            {side === "L" ? "Left" : "Right"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" aria-label="Spots in view">
                  {focus && (
                    <li>
                      <button
                        type="button"
                        onClick={() => openPlace({ region: focus.region, side: focus.side, site: null }, null)}
                        className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-white/[0.06]"
                        data-pain-whole-area
                      >
                        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-white/30 text-[11px] font-bold text-muted-foreground" aria-hidden>
                          ·
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium leading-tight">The whole {(focusRegionDef?.label ?? "area").toLowerCase()}</span>
                          <span className="block text-[12px] leading-snug text-muted-foreground">Not sure exactly where</span>
                        </span>
                        {pickedAreas.has(`${focus.region}:${focus.side ?? "-"}`) && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Picked" />}
                      </button>
                    </li>
                  )}
                  {inView.map((c) => {
                    const k = placeKey(c.part.site!, c.part.side);
                    const on = picked.has(k);
                    const s = siteOf(c.part.site);
                    const p = on ? picks.find((x) => x.site === c.part.site && (siteOf(x.site)?.midline || (x.side ?? null) === (c.part.side ?? null))) : null;
                    const sc = p ? pickScore(p) : null;
                    return (
                      <li key={c.part.id}>
                        <button
                          type="button"
                          onClick={() => openPlace({ region: c.part.region!, side: c.part.side, site: c.part.site }, c.part)}
                          onPointerDown={() => setPressed(c.part.id)}
                          onPointerUp={() => setPressed(null)}
                          onPointerLeave={() => setPressed(null)}
                          onPointerCancel={() => setPressed(null)}
                          className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]"
                          aria-label={`${siteLabel(c.part.site!, c.part.side)}${s?.anat ? `, ${s.anat}` : ""}`}
                          aria-pressed={on}
                          data-pain-label={c.part.site!}
                        >
                          <span
                            className={cn(
                              "flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums",
                              on ? "bg-primary text-primary-foreground" : "bg-white/90 text-black",
                            )}
                            aria-hidden
                          >
                            {c.n}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium leading-tight">
                              {c.sideTag && <span className="mr-1 text-[12px] font-bold text-muted-foreground">{c.sideTag === "L" ? "Left" : "Right"}</span>}
                              {s?.label}
                            </span>
                            {s?.anat && <span className="block text-[12px] leading-snug text-muted-foreground">{s.anat}</span>}
                          </span>
                          {on && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground">{sc != null ? `${sc}/10` : "rate it"}</span>}
                        </button>
                      </li>
                    );
                  })}
                  {!inView.length && !focus && <li className="px-2 py-3 text-[13px] text-muted-foreground">Move the body to see the spots here.</li>}
                </ul>
              </div>
            )}

          </div>

          {/* the way back, until a spot is picked (picking one goes back by itself) */}
          {!kb && !detail && mode === "map" && (
            <div className="shrink-0 border-t border-white/10 bg-[#0b0b0d] px-4 pt-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              <button type="button" onClick={close} className="h-12 w-full rounded-lg bg-white/[0.08] text-[15px] font-semibold text-foreground active:opacity-90" data-pain-map-done>
                {picks.length ? "Back to your report" : "Back"}
              </button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
