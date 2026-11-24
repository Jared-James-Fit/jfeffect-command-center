/**
 * The muscle map (muscle-read.ts): a 3D body built from the app's own
 * anatomical drawing (body3d/), coloured three ways (Distribution, Goal fit,
 * Development), turned with a finger, pinched or scrolled to zoom, a tap on a
 * muscle for why it's coloured that way. A 2D front-and-back drawing stands
 * in where WebGL2 isn't there (and on request), and the ranked list is the
 * same data as bars for anyone who'd rather read than turn a body.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FineMuscle } from "@/lib/analytics/training-load";
import type { MuscleRead, MuscleReadRow, FitStatus, DevStatus } from "@/lib/analytics/muscle-read";
import { atlasView, type ViewKey } from "@/lib/pain/anatomy/atlas";
import { muscleOfSite } from "@/lib/body3d/muscle-sites";
import { BODY_THEME, muscleAt, paintView } from "@/lib/body3d/paint";
import { Segmented } from "@/components/analytics/viz";

export type MuscleMode = "distribution" | "fit" | "development";
export const MUSCLE_MODES: Array<{ key: MuscleMode; label: string }> = [
  { key: "distribution", label: "Distribution" },
  { key: "fit", label: "Goal fit" },
  { key: "development", label: "Development" },
];

// The body is a 3D asset: its colours are concrete (the split / status
// palette's own values, light and dark), never resolved from CSS at draw time.
const PALETTE = {
  light: {
    rampFrom: [205, 222, 246],
    rampTo: [29, 95, 196],
    supported: "#1baf7a",
    look: "#e3a034",
    gap: "#d35a5a",
    more: "#3987e5",
    steady: "#8b93a1",
  },
  dark: {
    rampFrom: [58, 76, 102],
    rampTo: [100, 163, 245],
    supported: "#199e70",
    look: "#d9962e",
    gap: "#c94f4f",
    more: "#3987e5",
    steady: "#6b7280",
  },
} as const;

const FIT_WORD: Record<FitStatus, string> = {
  supported: "Supported",
  look: "Worth a look",
  gap: "Meaningful gap",
  more: "More than the rest",
  unknown: "Not enough data",
};
const DEV_WORD: Record<DevStatus, string> = {
  strength: "Progressing",
  opportunity: "Development opportunity",
  steady: "No clear signal",
  unknown: "Not enough data",
};

function useDark() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setDark(el.classList.contains("dark")));
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

export function muscleColor(
  row: MuscleReadRow | undefined,
  mode: MuscleMode,
  dark: boolean,
): string | null {
  if (!row) return null;
  const p = PALETTE[dark ? "dark" : "light"];
  if (mode === "distribution") {
    if (!(row.perWeek > 0)) return null;
    const t = Math.max(0.12, Math.min(1, row.share));
    const c = p.rampFrom.map((a, i) => Math.round(a + (p.rampTo[i] - a) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  if (mode === "fit") {
    const s = row.fit.status;
    return s === "unknown"
      ? null
      : s === "supported"
        ? row.perWeek > 0
          ? p.supported
          : null
        : p[s];
  }
  const s = row.dev.status;
  return s === "strength"
    ? p.supported
    : s === "opportunity"
      ? p.look
      : s === "steady"
        ? p.steady
        : null;
}

export function MuscleMap({ read, coached }: { read: MuscleRead; coached: boolean }) {
  const dark = useDark();
  const [mode, setMode] = useState<MuscleMode>("distribution");
  const [display, setDisplay] = useState<"body" | "list">("body");
  const rows = useMemo(() => new Map(read.rows.map((r) => [r.muscle, r])), [read]);
  // open on what matters for the mode: Development's first opportunity, Goal fit's first gap
  const firstFlag = useMemo(() => {
    if (mode === "fit")
      return (
        read.rows.find((r) => r.fit.status === "gap")?.muscle ??
        read.rows.find((r) => r.fit.status === "look")?.muscle ??
        null
      );
    if (mode === "development")
      return (
        read.rows.find((r) => r.dev.status === "opportunity")?.muscle ??
        read.rows.find((r) => r.dev.status === "strength")?.muscle ??
        null
      );
    return null;
  }, [read, mode]);
  const [picked, setPicked] = useState<FineMuscle | null>(null);
  useEffect(() => setPicked(firstFlag), [firstFlag]);
  const colorOf = useCallback(
    (m: FineMuscle) => muscleColor(rows.get(m), mode, dark),
    [rows, mode, dark],
  );
  const pickedRow = picked ? rows.get(picked) : undefined;

  return (
    <div data-muscle-map data-muscle-mode={mode}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={MUSCLE_MODES}
        label="Muscle map mode"
        size="sm"
      />
      <ModeLegend mode={mode} dark={dark} />
      {display === "body" ? (
        <div className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
          <BodyView
            colorOf={colorOf}
            picked={picked}
            onPick={setPicked}
            dark={dark}
            onList={() => setDisplay("list")}
          />
          <MuscleDetail
            row={pickedRow}
            mode={mode}
            coached={coached}
            enough={read.enoughData}
            onClear={() => setPicked(null)}
          />
        </div>
      ) : (
        <>
          <MuscleList
            read={read}
            mode={mode}
            dark={dark}
            picked={picked}
            onPick={setPicked}
            coached={coached}
          />
          <button
            type="button"
            onClick={() => setDisplay("body")}
            className="mt-2 inline-flex min-h-10 items-center text-[13px] font-medium text-foreground"
            data-muscle-show-body
          >
            Show the body
          </button>
        </>
      )}
      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        {mode === "distribution"
          ? "Working sets a week credited to each muscle: a full set from exercises aimed at it, half from ones that help. Where the work goes, not a measure of growth."
          : mode === "fit"
            ? `Each muscle against what your goal asks of it and your own typical volume for a main muscle (${read.reference} sets a week), never a universal target.`
            : "Only where two kinds of evidence agree: a lift that relies on the muscle and the muscle's own work. Fewer sets never means weak, and logs can't measure growth or imbalance."}
      </p>
    </div>
  );
}

function ModeLegend({ mode, dark }: { mode: MuscleMode; dark: boolean }) {
  const p = PALETTE[dark ? "dark" : "light"];
  const sw = (c: string, label: string) => (
    <span key={label} className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
      {label}
    </span>
  );
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
      data-muscle-legend
    >
      {mode === "distribution" ? (
        <span className="inline-flex items-center gap-1.5">
          Less
          {[0.15, 0.4, 0.7, 1].map((t) => {
            const c = p.rampFrom.map((a, i) => Math.round(a + (p.rampTo[i] - a) * t));
            return (
              <span
                key={t}
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: `rgb(${c.join(",")})` }}
              />
            );
          })}
          More
        </span>
      ) : mode === "fit" ? (
        [
          sw(p.supported, "Supported"),
          sw(p.look, "Worth a look"),
          sw(p.gap, "Gap"),
          sw(p.more, "More than the rest"),
        ]
      ) : (
        [sw(p.supported, "Progressing"), sw(p.look, "Opportunity"), sw(p.steady, "No clear signal")]
      )}
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-[3px] border border-border"
          style={{ background: BODY_THEME[dark ? "dark" : "light"].skin }}
        />
        {mode === "distribution" ? "Not trained" : "Not enough data"}
      </span>
    </div>
  );
}

// ── the body ───────────────────────────────────────────────────────────

type ViewSnap = "front" | "side" | "back";
const SNAP_YAW: Record<ViewSnap, number> = { front: 0.22, side: Math.PI / 2, back: Math.PI };

function BodyView({
  colorOf,
  picked,
  onPick,
  dark,
  onList,
}: {
  colorOf: (m: FineMuscle) => string | null;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle | null) => void;
  dark: boolean;
  onList: () => void;
}) {
  const [mode3d, setMode3d] = useState<"loading" | "3d" | "2d">("loading");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const rendRef = useRef<import("@/lib/body3d/renderer").BodyRenderer | null>(null);
  const animRef = useRef<number | null>(null);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [snap, setSnap] = useState<ViewSnap>("front");

  // build after the page paints: the mesh takes ~200 ms once, then it's cached
  useEffect(() => {
    let cancelled = false;
    const start = () => {
      void (async () => {
        try {
          const [{ bodyMesh }, { BodyRenderer, webgl2Available }] = await Promise.all([
            import("@/lib/body3d/body-mesh"),
            import("@/lib/body3d/renderer"),
          ]);
          if (cancelled) return;
          if (!webgl2Available()) return setMode3d("2d");
          const mesh = bodyMesh();
          if (cancelled || !canvasRef.current) return;
          const r = new BodyRenderer(canvasRef.current, mesh);
          r.cam = { yaw: reduced ? SNAP_YAW.front : -0.7, pitch: 0.04, zoom: 1, panY: 0 };
          rendRef.current = r;
          setMode3d("3d");
        } catch {
          setMode3d("2d");
        }
      })();
    };
    const w = window as any;
    const h = w.requestIdleCallback
      ? w.requestIdleCallback(start, { timeout: 600 })
      : window.setTimeout(start, 60);
    return () => {
      cancelled = true;
      if (w.cancelIdleCallback) w.cancelIdleCallback(h);
      else window.clearTimeout(h);
      rendRef.current?.dispose();
      rendRef.current = null;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = useCallback(() => {
    const r = rendRef.current;
    const c = canvasRef.current;
    const box = boxRef.current;
    if (!r || !c || !box) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(box.clientWidth * dpr);
    const h = Math.round(box.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    r.render();
  }, []);

  // repaint the skin whenever the colours, the pick or the theme change
  useEffect(() => {
    const r = rendRef.current;
    if (mode3d !== "3d" || !r) return;
    const th = BODY_THEME[dark ? "dark" : "light"];
    const views = (["front", "back", "side"] as ViewKey[]).map((k) =>
      paintView(k, colorOf, th, picked),
    );
    r.setTheme(dark);
    r.setTextures(views as [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement]);
    draw();
  }, [mode3d, colorOf, picked, dark, draw]);

  // a first, gentle turn into the three-quarter view (none with reduced motion)
  const animateTo = useCallback(
    (target: Partial<{ yaw: number; zoom: number; panY: number; pitch: number }>, ms = 650) => {
      const r = rendRef.current;
      if (!r) return;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const from = { ...r.cam };
      // the short way round
      let ty = target.yaw ?? from.yaw;
      while (ty - from.yaw > Math.PI) ty -= 2 * Math.PI;
      while (from.yaw - ty > Math.PI) ty += 2 * Math.PI;
      const to = { ...from, ...target, yaw: ty };
      if (reduced) {
        r.cam = to;
        draw();
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - k, 3);
        r.cam = {
          yaw: from.yaw + (to.yaw - from.yaw) * e,
          pitch: from.pitch + (to.pitch - from.pitch) * e,
          zoom: from.zoom + (to.zoom - from.zoom) * e,
          panY: from.panY + (to.panY - from.panY) * e,
        };
        draw();
        if (k < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    },
    [draw, reduced],
  );
  useEffect(() => {
    if (mode3d === "3d") animateTo({ yaw: SNAP_YAW.front }, 1100);
  }, [mode3d, animateTo]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);
    return () => ro.disconnect();
  }, [draw, mode3d]);

  // gestures: drag turns, pinch / wheel zooms, a still tap picks a muscle
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    x: number;
    y: number;
    t: number;
    moved: boolean;
    dist: number | null;
    zoom: number;
  } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    const r = rendRef.current;
    if (!r) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const pts = [...ptrs.current.values()];
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      moved: pts.length > 1,
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null,
      zoom: r.cam.zoom,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const r = rendRef.current;
    const g = gesture.current;
    if (!r || !g || !ptrs.current.has(e.pointerId)) return;
    const prev = ptrs.current.get(e.pointerId)!;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.current.values()];
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      r.cam.zoom = Math.max(1, Math.min(3.2, (g.zoom * d) / g.dist));
      g.moved = true;
      draw();
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) g.moved = true;
    if (!g.moved) return;
    r.cam.yaw += dx * 0.012;
    if (r.cam.zoom > 1.15)
      r.cam.panY = Math.max(-0.9, Math.min(0.9, r.cam.panY - dy * (0.004 / r.cam.zoom)));
    else r.cam.pitch = Math.max(-0.35, Math.min(0.35, r.cam.pitch + dy * 0.006));
    draw();
  };
  const onUp = (e: React.PointerEvent) => {
    const r = rendRef.current;
    const g = gesture.current;
    ptrs.current.delete(e.pointerId);
    if (!r || !g || ptrs.current.size) return;
    gesture.current = null;
    if (!g.moved && performance.now() - g.t < 400) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const hit = r.pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      if (!hit) return onPick(null);
      const { front, back } = hit.weights;
      const view: ViewKey =
        front >= back && front >= hit.weights.side
          ? "front"
          : back >= hit.weights.side
            ? "back"
            : "side";
      const [x, y, z] = hit.p;
      const m =
        view === "front"
          ? muscleAt("front", x, y)
          : view === "back"
            ? muscleAt("back", 400 - x, y)
            : muscleAt("side", z + 205, y);
      onPick(m);
    }
  };
  // a trackpad pinch (ctrl + wheel) or ⌘ / shift + wheel zooms; a plain wheel scrolls the page
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const r = rendRef.current;
      if (!r || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      e.preventDefault();
      r.cam.zoom = Math.max(1, Math.min(3.2, r.cam.zoom * Math.exp(-e.deltaY * 0.0025)));
      draw();
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [draw, mode3d]);
  const reset = () => animateTo({ yaw: SNAP_YAW[snap], zoom: 1, panY: 0, pitch: 0.04 });

  if (mode3d === "2d")
    return <Body2D colorOf={colorOf} picked={picked} onPick={onPick} dark={dark} />;
  return (
    <div className="relative" data-body3d={mode3d}>
      <div
        ref={boxRef}
        className={cn(
          "relative h-[420px] w-full touch-none select-none overflow-hidden rounded-2xl md:h-[480px]",
          "bg-[radial-gradient(ellipse_at_50%_40%,var(--muted)_0%,transparent_70%)]",
        )}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={reset}
        role="img"
        aria-label="Body coloured by the selected mode. Drag to turn, pinch to zoom, tap a muscle for details."
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {mode3d === "loading" && (
          <div className="absolute inset-0 jf-skeleton rounded-2xl bg-muted/40" aria-hidden />
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Segmented
          value={snap}
          onChange={(v) => {
            setSnap(v);
            animateTo({ yaw: SNAP_YAW[v] });
          }}
          options={[
            { key: "front", label: "Front" },
            { key: "side", label: "Side" },
            { key: "back", label: "Back" },
          ]}
          label="Turn the body to"
          size="sm"
          className="flex-1"
        />
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
          aria-label="Reset the view"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onList}
          className="h-9 shrink-0 rounded-lg border border-border px-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          data-muscle-show-list
        >
          List
        </button>
      </div>
    </div>
  );
}

/** The front and back drawings side by side, coloured the same way: the fallback, and lighter on old phones. */
function Body2D({
  colorOf,
  picked,
  onPick,
  dark,
}: {
  colorOf: (m: FineMuscle) => string | null;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle | null) => void;
  dark: boolean;
}) {
  const th = BODY_THEME[dark ? "dark" : "light"];
  return (
    <div className="grid grid-cols-2 gap-2" data-body2d>
      {(["front", "back"] as const).map((k) => {
        const v = atlasView(k, "R");
        return (
          <figure key={k} className="min-w-0">
            <svg
              viewBox="0 0 400 920"
              className="h-[340px] w-full"
              role="img"
              aria-label={`${k === "front" ? "Front" : "Back"} of the body`}
            >
              <path d={v.silhouette} fill={th.skin} />
              <path d={v.head} fill={th.skin} />
              {v.parts
                .filter((p) => !p.deep && p.kind === "muscle" && muscleOfSite(p.site))
                .map((p) => {
                  const m = muscleOfSite(p.site)!;
                  return (
                    <path
                      key={p.id}
                      d={p.d}
                      fill={colorOf(m) ?? th.skin}
                      stroke={picked === m ? th.pickEdge : th.line}
                      strokeWidth={picked === m ? 2.4 : 0.8}
                      onClick={() => onPick(m)}
                      className="cursor-pointer"
                    >
                      <title>{m}</title>
                    </path>
                  );
                })}
            </svg>
            <figcaption className="text-center text-[11px] text-muted-foreground">
              {k === "front" ? "Front" : "Back"}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

// ── detail & list ──────────────────────────────────────────────────────

function MuscleDetail({
  row,
  mode,
  coached,
  enough,
  onClear,
}: {
  row: MuscleReadRow | undefined;
  mode: MuscleMode;
  coached: boolean;
  enough: boolean;
  onClear: () => void;
}) {
  if (!row)
    return (
      <div
        className="rounded-2xl bg-muted/40 p-4 text-[13px] text-muted-foreground"
        data-muscle-detail-empty
      >
        {enough
          ? "Tap a muscle to see the work behind it."
          : "There isn't enough training in this period to read muscles yet. Pick a longer period above."}
      </div>
    );
  const status =
    mode === "fit"
      ? FIT_WORD[row.fit.status]
      : mode === "development"
        ? (row.dev.title ?? DEV_WORD[row.dev.status])
        : null;
  return (
    <div className="rounded-2xl bg-muted/40 p-4 text-[13px]" data-muscle-detail={row.muscle}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[16px] font-semibold text-foreground">{row.muscle}</div>
          {status && <div className="text-[12px] font-medium text-muted-foreground">{status}</div>}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="-mr-1 -mt-1 h-8 rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 tabular-nums">
        <span>
          <span className="block text-[11px] text-muted-foreground">Direct</span>
          <span className="text-[17px] font-semibold text-foreground">{row.directPerWeek}</span>
          <span className="text-[11px] text-muted-foreground"> sets/wk</span>
        </span>
        <span>
          <span className="block text-[11px] text-muted-foreground">Indirect</span>
          <span className="text-[17px] font-semibold text-foreground">{row.indirectPerWeek}</span>
          <span className="text-[11px] text-muted-foreground"> credited</span>
        </span>
        <span>
          <span className="block text-[11px] text-muted-foreground">Days a week</span>
          <span className="text-[17px] font-semibold text-foreground">{row.frequency || "—"}</span>
        </span>
      </div>
      {row.changePct != null && Math.abs(row.changePct) >= 10 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {row.changePct > 0 ? "Up" : "Down"} {Math.abs(row.changePct)}% over the last two weeks
          against the two before.
        </p>
      )}
      {mode === "fit" && <p className="mt-2 text-foreground/85">{row.fit.words}</p>}
      {mode === "development" && row.dev.why && (
        <p className="mt-2 text-foreground/85">{row.dev.why}</p>
      )}
      {mode === "development" && row.dev.evidence.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-muted-foreground">
          {row.dev.evidence.map((e) => (
            <li key={e}>· {e}</li>
          ))}
        </ul>
      )}
      {mode === "development" && row.dev.consider && (
        <p className="mt-2 text-[13px]">
          <span className="font-medium text-foreground">Consider: </span>
          <span className="text-muted-foreground">{row.dev.consider}</span>
        </p>
      )}
      {row.exercises.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] text-muted-foreground">Exercises behind it</div>
          <ul className="mt-1 space-y-0.5">
            {row.exercises.map((e) => (
              <li key={e.name} className="flex justify-between gap-2">
                <span className="truncate text-foreground">{e.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {e.sets} set{e.sets === 1 ? "" : "s"}
                  {e.direct ? "" : " · helps"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === "distribution" && row.role === "prime" && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          A main muscle for your goal{coached ? "; your coach plans its work" : ""}.
        </p>
      )}
    </div>
  );
}

function MuscleList({
  read,
  mode,
  dark,
  picked,
  onPick,
  coached,
}: {
  read: MuscleRead;
  mode: MuscleMode;
  dark: boolean;
  picked: FineMuscle | null;
  onPick: (m: FineMuscle | null) => void;
  coached: boolean;
}) {
  const order: Record<string, number> = {
    gap: 0,
    look: 1,
    more: 2,
    opportunity: 0,
    strength: 1,
    supported: 3,
    steady: 3,
    unknown: 4,
  };
  const rows = [...read.rows].sort((a, b) =>
    mode === "distribution"
      ? b.perWeek - a.perWeek
      : mode === "fit"
        ? order[a.fit.status] - order[b.fit.status] || b.perWeek - a.perWeek
        : order[a.dev.status] - order[b.dev.status] || b.perWeek - a.perWeek,
  );
  const max = Math.max(1, ...rows.map((r) => r.perWeek));
  const pickedRow = picked ? read.rows.find((r) => r.muscle === picked) : undefined;
  return (
    <div className="mt-2" data-muscle-list>
      <ul className="space-y-1">
        {rows.map((r) => {
          const c = muscleColor(r, mode, dark) ?? "var(--muted-foreground)";
          return (
            <li key={r.muscle}>
              <button
                type="button"
                onClick={() => onPick(picked === r.muscle ? null : r.muscle)}
                aria-pressed={picked === r.muscle}
                className={cn(
                  "flex min-h-10 w-full items-center gap-3 rounded-lg px-1.5 text-left transition hover:bg-muted/40",
                  picked === r.muscle && "bg-muted/60",
                )}
              >
                <span className="w-24 shrink-0 truncate text-[13px] text-foreground">
                  {r.muscle}
                </span>
                <span className="relative h-2.5 flex-1 rounded-full bg-muted/60">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${(r.perWeek / max) * 100}%`,
                      background: c,
                      minWidth: r.perWeek > 0 ? 4 : 0,
                    }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                  {mode === "distribution"
                    ? `${r.perWeek} sets/wk`
                    : mode === "fit"
                      ? FIT_WORD[r.fit.status]
                      : r.dev.status === "unknown" || r.dev.status === "steady"
                        ? `${r.perWeek} sets/wk`
                        : DEV_WORD[r.dev.status].split(" ")[0]}
                </span>
              </button>
              {picked === r.muscle && pickedRow && (
                <div className="mb-2 mt-1">
                  <MuscleDetail
                    row={pickedRow}
                    mode={mode}
                    coached={coached}
                    enough={read.enoughData}
                    onClear={() => onPick(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
