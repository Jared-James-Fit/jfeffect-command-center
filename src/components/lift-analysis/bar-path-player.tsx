/**
 * A set video with the bar's path drawn over it, and the marker the athlete
 * confirms or moves before (and after) it's read.
 *
 * Results: the rep on screen as a bright trail that follows the plate as it
 * plays, earlier reps faint, the plate's spot, the sticking point and the
 * bar's speed right now. Plays at full, half or quarter speed, steps a frame
 * at a time, and the scrubber marks where the plate was lost.
 *
 * Marker (confirm and fix): one ring on the plate's edge with its centre,
 * never a choice of circles (the parent hands it its one best guess). A
 * finger on the ring drags it (the picture under it magnified above the
 * finger, so the centre can be put exactly on the end of the bar), the
 * handle on its edge sizes it, and a tap elsewhere moves it there (the
 * parent snaps it to the plate it finds there). While fixing, the ring
 * follows the read path as the video moves and shows dashed where the plate
 * was lost; dragging it puts it right on that frame.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { noteShownAt, type Shape } from "@/lib/lift-analysis/film-notes";
import { frameAt } from "@/lib/lift-analysis/pose/skeleton";
import {
  drawBarPath,
  drawPose,
  drawShapes,
  nearestJoint,
  repAt,
  repSpan,
  valueAt,
  type PoseScene,
} from "@/components/lift-analysis/overlay-draw";
import { cn } from "@/lib/utils";

type Rect = { ox: number; oy: number; dw: number; dh: number };

export type PickSuggestion = { t: number; fx: number; fy: number; fr: number };

/** The marker: the plate's centre and semi-axes as shares of the shown frame, on the frame at t. */
export type Marker = { t: number; fx: number; fy: number; fa: number; fb: number };

export type MarkerMode = {
  /** The marker as placed (confirm), or null while it follows the read path (fix). */
  value: Marker | null;
  /** Fix: the corrections put in so far (shown on their frames and on the scrubber). */
  corrections?: Marker[];
  /** Fix: the ring's size while it follows the path. */
  size?: { fa: number; fb: number };
  /** The marker moved or resized (on release). */
  onChange: (m: Marker) => void;
  /** A tap away from the marker (the parent finds the plate there). */
  onTap?: (t: number, fx: number, fy: number) => void;
  /** Looking for the plate under a tap. */
  busy?: boolean;
};

export type DrawTool = "line" | "arrow" | "circle" | "joint";

/** Drawing a film note: the tool, the marks so far (shown while drawing), and each new mark. */
export type DrawMode = {
  tool: DrawTool;
  shapes: Shape[];
  onAdd: (shape: Shape, t: number) => void;
};

/** What a parent can ask of the player. */
export type PlayerApi = {
  time: () => number;
  seek: (t: number) => void;
  pause: () => void;
  /** Draws the overlays at a given size onto a frame the parent decoded (a saved frame). */
  drawOverlays: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
};

const SPEEDS = [1, 0.5, 0.25] as const;
/** How far (px) from the ring's edge handle a finger still grabs it, and from the ring the marker. */
const HANDLE_GRAB = 26;
const RING_GRAB = 18;
const LOUPE = { size: 124, zoom: 2.5, gap: 28 };

/**
 * Where the read path has the plate at a moment (shares of the frame), and
 * whether it was followed there; the last place it was seen when it wasn't.
 */
export function pathAt(
  a: LiftAnalysis,
  at: number,
): { fx: number; fy: number; found: boolean } | null {
  const S = a.series;
  if (!S.t.length) return null;
  let i = 0;
  while (i < S.t.length - 1 && S.t[i + 1] <= at) i++;
  const near = Math.abs(S.t[i] - at) <= 1.5 / Math.max(1, a.fps) || at >= S.t[0];
  if (near && S.ok[i]) {
    const x = valueAt(S.t, S.x, at);
    const y = valueAt(S.t, S.y, at);
    if (x != null && y != null) return { fx: x, fy: y, found: true };
  }
  // lost here: the last place it was followed
  for (let j = i; j >= 0; j--) if (S.ok[j]) return { fx: S.x[j], fy: S.y[j], found: false };
  for (let j = i; j < S.t.length; j++) if (S.ok[j]) return { fx: S.x[j], fy: S.y[j], found: false };
  return null;
}

function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

type Drag = {
  kind: "move" | "size" | "tap";
  id: number;
  startX: number;
  startY: number;
  /** The marker when the finger went down, and where on it the finger was (px). */
  m0: Marker | null;
  offX: number;
  offY: number;
  moved: boolean;
};

export function BarPathPlayer({
  src,
  poster,
  analysis,
  selectedRep,
  onSelectRep,
  marker,
  lost,
  initialTime,
  onVideoSize,
  technique,
  notes,
  focusNote,
  draw: drawMode,
  seekTo,
  apiRef,
  className,
}: {
  src?: string;
  poster?: string;
  analysis?: LiftAnalysis | null;
  selectedRep: number | null;
  onSelectRep: (i: number | null) => void;
  /** Show the marker to confirm or fix instead of (or as well as) the path. */
  marker?: MarkerMode | null;
  /** Stretches (s) where the plate wasn't followed, marked on the scrubber. */
  lost?: { start: number; end: number }[];
  /** Open paused on this moment (the marker's frame). */
  initialTime?: number | null;
  /** The clip's own size, once it's known (for sizing a ring as a circle). */
  onVideoSize?: (width: number, height: number) => void;
  /** Technique: the athlete's body and the layers switched on (the bar path follows `layers.bar`). */
  technique?: PoseScene | null;
  /** Film notes, each shown around its moment. */
  notes?: { id: string; t: number; shapes: Shape[] }[];
  /** The note picked: shown whatever the time. */
  focusNote?: string | null;
  /** Drawing a film note (the player takes the finger instead of the marker). */
  draw?: DrawMode | null;
  /** Jump here (paused): a new `n` each time. */
  seekTo?: { t: number; n: number } | null;
  apiRef?: React.MutableRefObject<PlayerApi | null>;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof SPEEDS)[number]>(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const timeRef = useRef(0);
  const dragRef = useRef<Drag | null>(null);
  /** The marker while a finger moves it (drawn without waiting for the parent). */
  const liveRef = useRef<Marker | null>(null);
  /** A mark being drawn (from where the finger went down to where it is). */
  const sketchRef = useRef<{ id: number; a: [number, number]; b: [number, number] } | null>(null);
  const fps = analysis?.fps && analysis.fps > 1 ? analysis.fps : 30;

  const rect = useCallback((): Rect | null => {
    const v = videoRef.current;
    const box = boxRef.current;
    if (!v || !box || !v.videoWidth) return null;
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    const s = Math.min(cw / v.videoWidth, ch / v.videoHeight);
    const dw = v.videoWidth * s;
    const dh = v.videoHeight * s;
    return { ox: (cw - dw) / 2, oy: (ch - dh) / 2, dw, dh };
  }, []);

  /** The marker to draw now: being dragged, placed, a correction on this frame, or following the path. */
  const shownMarker = useCallback((): { m: Marker; lost: boolean } | null => {
    if (!marker) return null;
    if (liveRef.current) return { m: liveRef.current, lost: false };
    if (marker.value) return { m: marker.value, lost: false };
    const now = timeRef.current;
    const half = 0.6 / fps;
    const corr = marker.corrections?.find((c) => Math.abs(c.t - now) <= half);
    if (corr) return { m: corr, lost: false };
    if (analysis && marker.size) {
      const p = pathAt(analysis, now);
      if (p) return { m: { t: now, fx: p.fx, fy: p.fy, ...marker.size }, lost: !p.found };
    }
    return null;
  }, [analysis, fps, marker]);

  /** Everything over the video at a moment: the bar, the body, the notes, a mark being drawn. */
  const drawScene = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      P: (fx: number, fy: number) => [number, number],
      now: number,
      k: number,
    ) => {
      const pose = technique ? frameAt(technique.track, now) : null;
      if (technique) drawPose(ctx, technique, analysis ?? null, P, now, { selectedRep, scale: k });
      if (analysis && (technique ? technique.layers.bar : true))
        drawBarPath(ctx, analysis, P, now, { selectedRep, playing, scale: k });
      for (const n of notes ?? []) {
        if (n.id === focusNote || noteShownAt(n, now)) drawShapes(ctx, n.shapes, P, pose, k);
      }
      if (drawMode) {
        drawShapes(ctx, drawMode.shapes, P, pose, k);
        const sk = sketchRef.current;
        if (sk && drawMode.tool !== "joint")
          drawShapes(ctx, [{ kind: drawMode.tool, a: sk.a, b: sk.b }], P, pose, k, true);
      }
    },
    [analysis, drawMode, focusNote, notes, playing, selectedRep, technique],
  );

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const box = boxRef.current;
    if (!c || !box) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const r = rect();
    if (!r) return;
    const now = timeRef.current;
    const P = (fx: number, fy: number): [number, number] => [r.ox + fx * r.dw, r.oy + fy * r.dh];

    if (marker) {
      const shown = shownMarker();
      if (shown) drawMarker(ctx, shown.m, r, shown.lost, !!marker.busy);
      const d = dragRef.current;
      if (d && d.kind !== "tap" && shown && videoRef.current) {
        drawLoupe(ctx, videoRef.current, shown.m, r, d.kind, cw);
      }
      if (marker.value || marker.corrections || !analysis) return;
    }

    drawScene(ctx, P, now, 1);
  }, [analysis, marker, rect, shownMarker, drawScene]);

  // follow the video frame by frame (requestVideoFrameCallback where there is one)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let stop = false;
    let handle = 0;
    const rvfc = (
      v as HTMLVideoElement & {
        requestVideoFrameCallback?: (
          cb: (now: number, meta: { mediaTime: number }) => void,
        ) => number;
      }
    ).requestVideoFrameCallback;
    const tick = (_n?: number, meta?: { mediaTime: number }) => {
      if (stop) return;
      timeRef.current = meta?.mediaTime ?? v.currentTime;
      draw();
      if (typeof rvfc === "function") handle = rvfc.call(v, tick);
      else handle = requestAnimationFrame(() => tick());
    };
    tick();
    const sync = () => {
      timeRef.current = v.currentTime;
      setTime(v.currentTime);
      if (Number.isFinite(v.duration)) setDuration(v.duration);
      draw();
    };
    v.addEventListener("seeked", sync);
    v.addEventListener("timeupdate", sync);
    v.addEventListener("loadeddata", sync);
    v.addEventListener("durationchange", sync);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
    if (boxRef.current) ro?.observe(boxRef.current);
    return () => {
      stop = true;
      const cancel = (v as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void })
        .cancelVideoFrameCallback;
      if (typeof rvfc === "function" && typeof cancel === "function") cancel.call(v, handle);
      else cancelAnimationFrame(handle);
      v.removeEventListener("seeked", sync);
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("loadeddata", sync);
      v.removeEventListener("durationchange", sync);
      ro?.disconnect();
    };
  }, [draw, src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = Math.max(0, Math.min(v.duration || t, t));
    } catch {
      /* not seekable yet */
    }
  }, []);

  // a picked rep: show it from just before it starts
  useEffect(() => {
    const v = videoRef.current;
    if (!v || selectedRep == null || !analysis) return;
    const sp = repSpan(analysis, selectedRep);
    if (!sp) return;
    v.pause();
    seek(Math.max(0, sp.start - 0.25));
  }, [selectedRep, analysis, seek]);

  // opened on a moment (the marker's frame): pause there
  useEffect(() => {
    const v = videoRef.current;
    if (!v || initialTime == null) return;
    v.pause();
    seek(initialTime);
  }, [initialTime, seek, ready]);

  // asked to jump to a moment (a note, an observation): pause there
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seekTo) return;
    v.pause();
    seek(seekTo.t);
  }, [seekTo, seek]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      time: () => videoRef.current?.currentTime ?? timeRef.current,
      seek: (t: number) => {
        videoRef.current?.pause();
        seek(t);
      },
      pause: () => videoRef.current?.pause(),
      drawOverlays: (ctx, w, h, t) => {
        // drawn at the frame's own size: lines and labels scaled to read the same as on a phone
        const k = Math.max(1, Math.max(w, h) / 640);
        drawScene(ctx, (fx, fy) => [fx * w, fy * h], t, k);
      },
    };
    return () => {
      if (apiRef.current) apiRef.current = null;
    };
  }, [apiRef, seek, drawScene]);

  const step = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seek(v.currentTime + dir / fps);
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (selectedRep != null) onSelectRep(null);
      void v.play().catch(() => {});
    } else v.pause();
  };

  /* ── the marker under a finger ─────────────────────────────────────── */

  const toFrame = (clientX: number, clientY: number) => {
    const r = rect();
    const box = boxRef.current;
    if (!r || !box) return null;
    const b = box.getBoundingClientRect();
    return {
      px: clientX - b.left,
      py: clientY - b.top,
      fx: (clientX - b.left - r.ox) / r.dw,
      fy: (clientY - b.top - r.oy) / r.dh,
      r,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawMode && !marker) {
      const p = toFrame(e.clientX, e.clientY);
      if (!p || sketchRef.current) return;
      videoRef.current?.pause();
      if (drawMode.tool === "joint") {
        const pose = technique ? frameAt(technique.track, timeRef.current) : null;
        const j = nearestJoint(pose, p.fx, p.fy, p.r.dw, p.r.dh, 36);
        if (j != null) drawMode.onAdd({ kind: "joint", j }, timeRef.current);
        return;
      }
      sketchRef.current = { id: e.pointerId, a: [p.fx, p.fy], b: [p.fx, p.fy] };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* the moves still come while the finger stays inside */
      }
      e.preventDefault();
      draw();
      return;
    }
    if (!marker || dragRef.current) return;
    const p = toFrame(e.clientX, e.clientY);
    if (!p) return;
    const shown = shownMarker();
    let kind: Drag["kind"] = "tap";
    let offX = 0;
    let offY = 0;
    if (shown) {
      const [cx, cy] = [p.r.ox + shown.m.fx * p.r.dw, p.r.oy + shown.m.fy * p.r.dh];
      const ra = shown.m.fa * p.r.dw;
      const rb = shown.m.fb * p.r.dh;
      const [hx, hy] = handleAt(cx, cy, ra, rb);
      const dist = Math.hypot((p.px - cx) / Math.max(1, ra), (p.py - cy) / Math.max(1, rb));
      if (Math.hypot(p.px - hx, p.py - hy) <= HANDLE_GRAB) kind = "size";
      else if (dist <= 1 + RING_GRAB / Math.max(8, Math.min(ra, rb))) {
        kind = "move";
        offX = p.px - cx;
        offY = p.py - cy;
      }
    }
    videoRef.current?.pause();
    dragRef.current = {
      kind,
      id: e.pointerId,
      startX: p.px,
      startY: p.py,
      m0: shown ? { ...shown.m, t: timeRef.current } : null,
      offX,
      offY,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: the moves still come while the finger stays inside */
    }
    if (kind !== "tap") e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const sk = sketchRef.current;
    if (sk && sk.id === e.pointerId) {
      const p = toFrame(e.clientX, e.clientY);
      if (p) {
        sk.b = [p.fx, p.fy];
        draw();
      }
      return;
    }
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId || !marker) return;
    const p = toFrame(e.clientX, e.clientY);
    if (!p) return;
    if (Math.hypot(p.px - d.startX, p.py - d.startY) > 6) d.moved = true;
    if (d.kind === "tap" || !d.m0) return;
    if (d.kind === "move") {
      liveRef.current = {
        ...d.m0,
        fx: (p.px - d.offX - p.r.ox) / p.r.dw,
        fy: (p.py - d.offY - p.r.oy) / p.r.dh,
      };
    } else {
      // the handle sits on the ring's lower right: its distance from the centre sets the size, shape kept
      const cx = p.r.ox + d.m0.fx * p.r.dw;
      const cy = p.r.oy + d.m0.fy * p.r.dh;
      const ra0 = d.m0.fa * p.r.dw;
      const rb0 = d.m0.fb * p.r.dh;
      const [hx0, hy0] = handleAt(cx, cy, ra0, rb0);
      const k = Math.max(
        0.3,
        Math.hypot(p.px - cx, p.py - cy) / Math.max(1, Math.hypot(hx0 - cx, hy0 - cy)),
      );
      liveRef.current = { ...d.m0, fa: d.m0.fa * k, fb: d.m0.fb * k };
    }
    draw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const sk = sketchRef.current;
    if (sk && sk.id === e.pointerId) {
      sketchRef.current = null;
      if (
        drawMode &&
        drawMode.tool !== "joint" &&
        Math.hypot(sk.a[0] - sk.b[0], sk.a[1] - sk.b[1]) > 0.01
      )
        drawMode.onAdd({ kind: drawMode.tool, a: sk.a, b: sk.b }, timeRef.current);
      draw();
      return;
    }
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    const live = liveRef.current;
    liveRef.current = null;
    if (d.kind === "tap") {
      if (!d.moved && marker?.onTap) {
        const p = toFrame(e.clientX, e.clientY);
        if (p && p.fx >= 0 && p.fx <= 1 && p.fy >= 0 && p.fy <= 1)
          marker.onTap(videoRef.current?.currentTime ?? 0, p.fx, p.fy);
      }
      draw();
      return;
    }
    if (live && d.moved) marker?.onChange({ ...live, t: videoRef.current?.currentTime ?? live.t });
    draw();
  };

  const liveV =
    analysis &&
    analysis.units === "mm" &&
    !marker &&
    !drawMode &&
    (technique ? technique.layers.bar : true)
      ? valueAt(analysis.series.t, analysis.series.v, time)
      : null;

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        ref={boxRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-black",
          (marker || drawMode) && "touch-none",
          drawMode && "cursor-crosshair",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-bar-path-player
        data-marker-mode={marker ? (marker.size ? "fix" : "confirm") : undefined}
        data-draw-tool={drawMode?.tool}
        data-technique={technique ? "on" : undefined}
        data-marker={
          marker?.value
            ? [marker.value.fx, marker.value.fy, marker.value.fa, marker.value.fb]
                .map((v) => v.toFixed(4))
                .join(",")
            : undefined
        }
      >
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          playsInline
          muted
          preload="auto"
          className="absolute inset-0 h-full w-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            setReady(true);
            const v = e.currentTarget;
            if (Number.isFinite(v.duration)) setDuration(v.duration);
            if (v.videoWidth && v.videoHeight) onVideoSize?.(v.videoWidth, v.videoHeight);
            // open on the set itself (the clip is never cut: everything before it is still there)
            if (
              initialTime == null &&
              analysis &&
              v.currentTime < 0.05 &&
              analysis.window.start > 0.3
            )
              seek(analysis.window.start);
          }}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {liveV != null && Math.abs(liveV) >= 0.03 && (
          <div
            className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[13px] font-semibold tabular-nums text-white"
            data-live-speed
          >
            {liveV > 0 ? "↑" : "↓"} {Math.abs(liveV).toFixed(2)} m/s
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] tabular-nums text-white/90">
          {clock(time)}
        </div>
      </div>
      <Scrubber
        duration={duration}
        time={time}
        lost={lost ?? []}
        marks={marker?.corrections?.map((c) => c.t) ?? []}
        onSeek={(t) => {
          videoRef.current?.pause();
          seek(t);
        }}
      />
      <div className="flex items-center gap-1 px-2 pb-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={!ready}
          aria-label="Back a frame"
          className="grid h-10 w-10 place-items-center rounded-full text-foreground hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-foreground disabled:opacity-40"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-px" />}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={!ready}
          aria-label="Forward a frame"
          className="grid h-10 w-10 place-items-center rounded-full text-foreground hover:bg-muted disabled:opacity-40"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setRate((r) => SPEEDS[(SPEEDS.indexOf(r) + 1) % SPEEDS.length])}
          className="ml-1 h-10 min-w-[3rem] rounded-full px-2 text-[13px] font-semibold tabular-nums text-foreground hover:bg-muted"
          aria-label="Playback speed"
          data-playback-rate
        >
          {rate === 1 ? "1×" : rate === 0.5 ? "½×" : "¼×"}
        </button>
        {analysis && !marker && analysis.reps.length > 0 && (
          <div className="ml-auto flex min-w-0 gap-1 overflow-x-auto" data-rep-chips>
            {analysis.reps.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectRep(selectedRep === i ? null : i)}
                className={cn(
                  "h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold tabular-nums",
                  selectedRep === i
                    ? "bg-foreground text-background"
                    : "bg-secondary text-foreground",
                  !r.complete && "line-through decoration-1",
                )}
                aria-label={`Rep ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The ring's edge handle: on its lower right, where a thumb reaches it without covering the plate. */
function handleAt(cx: number, cy: number, ra: number, rb: number): [number, number] {
  const th = Math.PI / 4;
  return [cx + ra * Math.cos(th), cy + rb * Math.sin(th)];
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  m: Marker,
  r: Rect,
  lost: boolean,
  busy: boolean,
) {
  const cx = r.ox + m.fx * r.dw;
  const cy = r.oy + m.fy * r.dh;
  const ra = Math.max(4, m.fa * r.dw);
  const rb = Math.max(4, m.fb * r.dh);
  const ring = (w: number, color: string) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ra, rb, 0, 0, Math.PI * 2);
    ctx.stroke();
  };
  ctx.setLineDash(lost || busy ? [7, 6] : []);
  ring(4.5, "rgba(0,0,0,0.5)");
  ring(2, lost ? "#f59e0b" : "#ffffff");
  ctx.setLineDash([]);
  // the centre: the point that's tracked
  const arm = Math.min(10, 0.45 * Math.min(ra, rb));
  for (const [w, color] of [
    [4, "rgba(0,0,0,0.55)"],
    [1.8, lost ? "#f59e0b" : "#ffffff"],
  ] as const) {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy);
    ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm);
    ctx.lineTo(cx, cy + arm);
    ctx.stroke();
  }
  if (!lost) {
    const [hx, hy] = handleAt(cx, cy, ra, rb);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** The picture under the marker magnified above the finger, with the ring and centre drawn on it. */
function drawLoupe(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  m: Marker,
  r: Rect,
  kind: "move" | "size",
  boxWidth: number,
) {
  if (!video.videoWidth) return;
  const cx = r.ox + m.fx * r.dw;
  const cy = r.oy + m.fy * r.dh;
  const ra = m.fa * r.dw;
  const rb = m.fb * r.dh;
  // what's looked at: the centre while moving, the edge while sizing
  const [fx, fy] = kind === "move" ? [cx, cy] : handleAt(cx, cy, ra, rb);
  const S = LOUPE.size;
  const Z = LOUPE.zoom;
  let lx = fx - S / 2;
  let ly = fy - S - LOUPE.gap - Math.max(ra, rb) * (kind === "move" ? 1 : 0.2);
  if (ly < 6) ly = fy + LOUPE.gap + Math.max(ra, rb);
  lx = Math.max(6, Math.min(boxWidth - S - 6, lx));
  const k = video.videoWidth / r.dw;
  const half = S / (2 * Z);
  ctx.save();
  ctx.beginPath();
  ctx.arc(lx + S / 2, ly + S / 2, S / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(lx, ly, S, S);
  try {
    ctx.drawImage(
      video,
      (fx - r.ox - half) * k,
      (fy - r.oy - half) * k,
      2 * half * k,
      2 * half * k,
      lx,
      ly,
      S,
      S,
    );
  } catch {
    /* no frame yet */
  }
  // the ring and centre, magnified
  const toL = (x: number, y: number): [number, number] => [
    lx + S / 2 + (x - fx) * Z,
    ly + S / 2 + (y - fy) * Z,
  ];
  const [mcx, mcy] = toL(cx, cy);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(mcx, mcy, ra * Z, rb * Z, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mcx - 12, mcy);
  ctx.lineTo(mcx + 12, mcy);
  ctx.moveTo(mcx, mcy - 12);
  ctx.lineTo(mcx, mcy + 12);
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(lx + S / 2, ly + S / 2, S / 2, 0, Math.PI * 2);
  ctx.stroke();
}

/** A thin timeline: where the video is, where the plate was lost (amber), and the fixes (white ticks). */
function Scrubber({
  duration,
  time,
  lost,
  marks,
  onSeek,
}: {
  duration: number;
  time: number;
  lost: { start: number; end: number }[];
  marks: number[];
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const active = useRef<number | null>(null);
  const at = (clientX: number) => {
    const el = ref.current;
    if (!el || !(duration > 0)) return null;
    const b = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - b.left) / b.width)) * duration;
  };
  const pct = (t: number) => `${duration > 0 ? (100 * t) / duration : 0}%`;
  return (
    <div
      ref={ref}
      className="relative mx-3 mt-1 h-7 cursor-pointer touch-none"
      role="slider"
      aria-label="Position in the video"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 100) / 100}
      aria-valuenow={Math.round(time * 100) / 100}
      tabIndex={0}
      data-scrubber
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 0.5));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 0.5));
      }}
      onPointerDown={(e) => {
        const t = at(e.clientX);
        if (t == null) return;
        active.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onSeek(t);
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId) return;
        const t = at(e.clientX);
        if (t != null) onSeek(t);
      }}
      onPointerUp={() => (active.current = null)}
      onPointerCancel={() => (active.current = null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: pct(time) }} />
      </div>
      {lost.map((s, i) => (
        <div
          key={i}
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-warning"
          style={{ left: pct(s.start), width: `max(4px, ${pct(Math.max(0, s.end - s.start))})` }}
          data-lost-stretch
        />
      ))}
      {marks.map((t, i) => (
        <div
          key={`m${i}`}
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground"
          style={{ left: pct(t) }}
        />
      ))}
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
        style={{ left: pct(time) }}
      />
    </div>
  );
}
