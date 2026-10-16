import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { VIDEO_LIMITS, formatClock, videoLimit } from "@/lib/video-edit/limits";
import { defaultTrim, maxSelectable, type VideoTrim } from "@/lib/video-edit/plan";
import type { TrimFn, TrimRequest } from "@/lib/video-edit/pick";
import { createThumbnailer, type Thumbnailer } from "@/lib/video-edit/thumbs";
import {
  centerSelectionOn, clampView, edgePan, needsOverview, normalizeSelection, setEnd, setStart, shiftSelection, tileGrid, timeToX, viewAround, viewSpan, xToTime,
} from "@/lib/video-edit/timeline";

type Pending = TrimRequest & { resolve: (v: VideoTrim | null) => void };

/**
 * The trimmer, opened from wherever a video is picked:
 *   const trimmer = useVideoTrimmer();
 *   … pickVideo(file, "story", { trim: trimmer.request }) …
 *   return <>{…}{trimmer.element}</>;
 * Render `element` inside the screen's own dialog (if it has one), so the
 * trimmer stacks on top of it instead of closing it.
 */
export function useVideoTrimmer() {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  const request = useCallback<TrimFn>(
    (req) =>
      new Promise<VideoTrim | null>((resolve) => {
        // one at a time: a newer request answers the older one with "backed out"
        pendingRef.current?.resolve(null);
        setPending({ ...req, resolve });
      }),
    [],
  );
  // the screen closed under it: nothing was chosen
  useEffect(() => () => pendingRef.current?.resolve(null), []);
  const finish = useCallback((v: VideoTrim | null) => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    p.resolve(v);
  }, []);
  const element = pending ? <VideoTrimmer key={`${pending.file.name}:${pending.file.size}:${pending.step?.index ?? 0}`} req={pending} onDone={finish} /> : null;
  return { request, element, open: !!pending };
}

const TILE_H = 48;
const HANDLE_W = 16;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Drag = {
  kind: "start" | "end" | "body" | "pan";
  id: number;
  downX: number;
  lastX: number;
  grab: number;
  selDown: VideoTrim;
  viewDown: number;
  moved: boolean;
  wasPlaying: boolean;
};

export function VideoTrimmer({ req, onDone }: { req: TrimRequest; onDone: (v: VideoTrim | null) => void }) {
  const { file, info, canEncode, context, step } = req;
  const duration = info.duration;
  const limit = videoLimit(context);
  const maxLen = maxSelectable(info, context, canEncode);
  const [sel, setSel] = useState<VideoTrim>(() => normalizeSelection(req.initial ?? defaultTrim(info, context, canEncode), maxLen, duration));
  const span = useMemo(() => viewSpan(duration, maxLen), [duration, maxLen]);
  const [viewStart, setViewStart] = useState(() => viewAround(sel, span, duration));
  const overview = needsOverview(duration, maxLen);
  const selRef = useRef(sel);
  selRef.current = sel;
  const viewRef = useRef(viewStart);
  viewRef.current = viewStart;

  // A clip this phone can only cut on keyframes: the start moves back to the
  // one at or before it (never losing a frame you chose), the end stays in the
  // limit, and you see exactly what goes.
  const snapStart = req.snapStart ?? null;
  const snapSeq = useRef(0);
  const snapNow = useCallback(async (s: VideoTrim): Promise<VideoTrim> => {
    if (!snapStart) return s;
    const n = ++snapSeq.current;
    const k = await snapStart(s.start);
    if (n !== snapSeq.current || k >= s.start - 0.01) return selRef.current;
    const next = { start: k, end: Math.min(s.end, k + maxLen) };
    selRef.current = next;
    setSel(next);
    return next;
  }, [snapStart, maxLen]);
  useEffect(() => {
    void snapNow(selRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- preview ------------------------------------------------------ */
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  // a format this browser can't show (an iPhone HEVC clip on some desktops): trim by the times instead
  const [noPreview, setNoPreview] = useState(false);
  const seekRaf = useRef<number | null>(null);
  const seekTarget = useRef<{ t: number; fast: boolean } | null>(null);
  // one seek per frame however fast the finger moves; the fast kind (nearest keyframe) while dragging
  const seek = useCallback((t: number, fast = false) => {
    seekTarget.current = { t, fast };
    if (seekRaf.current != null) return;
    seekRaf.current = requestAnimationFrame(() => {
      seekRaf.current = null;
      const v = videoRef.current;
      const s = seekTarget.current;
      if (!v || !s) return;
      const t2 = Math.max(0, Math.min(s.t, Math.max(0, (v.duration || duration) - 0.03)));
      const anyV = v as HTMLVideoElement & { fastSeek?: (t: number) => void };
      try {
        if (s.fast && typeof anyV.fastSeek === "function") anyV.fastSeek(t2);
        else v.currentTime = t2;
      } catch { /* not seekable yet */ }
    });
  }, [duration]);
  useEffect(() => () => { if (seekRaf.current != null) cancelAnimationFrame(seekRaf.current); }, []);

  const play = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const s = selRef.current;
    if (v.currentTime < s.start - 0.05 || v.currentTime >= s.end - 0.05) v.currentTime = s.start;
    void v.play().catch(() => setPlaying(false));
  }, []);
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) play();
    else v.pause();
  }, [play]);
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (v.paused) play();
  };

  // loop inside the selection, and move the playhead (straight on the element, no re-render)
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const [stripW, setStripW] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      const s = selRef.current;
      if (!v.paused && !dragRef.current && (v.currentTime >= s.end - 0.04 || v.currentTime < s.start - 0.25)) v.currentTime = s.start;
      const ph = playheadRef.current;
      if (ph) {
        const x = timeToX(v.currentTime, viewRef.current, span, stripW);
        const show = !dragRef.current && v.currentTime >= s.start - 0.05 && v.currentTime <= s.end + 0.05 && x >= 0 && x <= stripW;
        ph.style.opacity = show ? "1" : "0";
        ph.style.transform = `translateX(${x}px)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [span, stripW]);

  /* ---- filmstrip ---------------------------------------------------- */
  // State, not a ref: the dialog's content mounts a frame after this does, so the
  // strip is measured whenever it actually appears (a ref read on mount found nothing)
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stripEl;
    if (!el) return;
    const measure = () => setStripW(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stripEl]);
  const aspect = info.width && info.height ? info.width / info.height : 9 / 16;
  const tileW = Math.max(27, Math.min(86, Math.round(TILE_H * aspect)));
  const tiles = stripW ? Math.max(4, Math.round(stripW / tileW)) : 0;
  const detail = useMemo(() => (tiles ? tileGrid(viewStart, span, tiles, duration) : []), [viewStart, span, tiles, duration]);
  const overTiles = useMemo(() => (tiles && overview ? tileGrid(0, duration, Math.max(6, Math.round(stripW / (tileW * 0.62))), duration) : []), [tiles, overview, duration, stripW, tileW]);

  // one frame maker for the whole visit, made once the strip has a size
  const [thumbs, setThumbs] = useState<Thumbnailer | null>(null);
  const thumbRef = useRef<Thumbnailer | null>(null);
  thumbRef.current = thumbs;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!tiles || thumbRef.current) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    setThumbs(createThumbnailer(file, { width: tileW * dpr, height: TILE_H * dpr, span: span / tiles }));
  }, [tiles, file, tileW, span]);
  useEffect(() => {
    if (!thumbs) return;
    let raf = 0;
    const off = thumbs.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; bump(); });
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
      thumbs.dispose();
    };
  }, [thumbs]);
  // what's on screen first, nearest the selection first, then the overview
  useEffect(() => {
    if (!thumbs) return;
    const mid = (sel.start + sel.end) / 2;
    const near = [...detail].sort((a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid)).map((d) => d.t);
    thumbs.want([...near, ...overTiles.map((d) => d.t)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, overTiles, thumbs]);

  /* ---- drag --------------------------------------------------------- */
  const [dragging, setDragging] = useState<Drag["kind"] | null>(null);
  const toX = (t: number) => timeToX(t, viewStart, span, stripW);
  const apply = useCallback((x: number) => {
    const d = dragRef.current;
    if (!d || !stripW) return;
    const t = xToTime(x, viewRef.current, span, stripW);
    if (d.kind === "start") {
      const next = setStart(selRef.current, t - d.grab, maxLen, duration);
      selRef.current = next;
      setSel(next);
      seek(next.start, true);
    } else if (d.kind === "end") {
      const next = setEnd(selRef.current, t - d.grab, maxLen, duration);
      selRef.current = next;
      setSel(next);
      seek(next.end, true);
    } else if (d.kind === "body") {
      const next = shiftSelection(d.selDown, ((x - d.downX) / stripW) * span, duration);
      selRef.current = next;
      setSel(next);
      seek(next.start, true);
    } else {
      const v = clampView(d.viewDown - ((x - d.downX) / stripW) * span, span, duration);
      viewRef.current = v;
      setViewStart(v);
    }
  }, [stripW, span, maxLen, duration, seek]);

  // holding a handle at the strip's edge pans the strip, and the handle with it
  useEffect(() => {
    if (dragging !== "start" && dragging !== "end") return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const d = dragRef.current;
      if (!d || !d.moved) return;
      const pan = edgePan(d.lastX, stripW, span);
      if (!pan) return;
      const v = clampView(viewRef.current + pan, span, duration);
      if (v === viewRef.current) return;
      viewRef.current = v;
      setViewStart(v);
      apply(d.lastX);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging, stripW, span, duration, apply]);

  const onStripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stripW || (e.pointerType === "mouse" && e.button !== 0)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const xs = toX(sel.start);
    const xe = toX(sel.end);
    // the handles win near their edges; a short selection gives each its own outer half
    const nearS = Math.abs(x - (xs - HANDLE_W / 2));
    const nearE = Math.abs(x - (xe + HANDLE_W / 2));
    let kind: Drag["kind"];
    if (nearS <= 24 && (nearS <= nearE || x < (xs + xe) / 2)) kind = "start";
    else if (nearE <= 24) kind = "end";
    else if (x > xs && x < xe) kind = "body";
    else kind = "pan";
    const t = xToTime(x, viewStart, span, stripW);
    const v = videoRef.current;
    dragRef.current = {
      kind,
      id: e.pointerId,
      downX: x,
      lastX: x,
      grab: kind === "start" ? t - sel.start : kind === "end" ? t - sel.end : 0,
      selDown: sel,
      viewDown: viewStart,
      moved: false,
      wasPlaying: !!v && !v.paused,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(kind);
  };
  const onStripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    d.lastX = x;
    if (!d.moved && Math.abs(x - d.downX) < 4) return;
    if (!d.moved) {
      d.moved = true;
      videoRef.current?.pause();
    }
    apply(x);
  };
  const onStripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    const s = selRef.current;
    if (!d.moved) {
      // a tap: inside the clip plays from there; outside it moves the clip there
      const t = xToTime(d.downX, viewRef.current, span, stripW);
      if (d.kind === "pan") {
        const next = centerSelectionOn(s, t, duration);
        setSel(next);
        selRef.current = next;
        seek(next.start);
        play();
        void snapNow(next).then((n) => n.start !== next.start && seek(n.start));
      } else {
        seek(Math.max(s.start, Math.min(t, s.end - 0.1)));
        if (!playing) play();
      }
      return;
    }
    // the clip slid out of the strip: bring it back into view
    const vs = viewRef.current;
    if (s.start < vs || s.end > vs + span) setViewStart(viewAround(s, span, duration));
    seek(s.start);
    if (d.wasPlaying || d.kind !== "pan") play();
    if (d.kind !== "pan") void snapNow(s).then((n) => n.start !== s.start && seek(n.start));
  };

  /* ---- overview (long videos) --------------------------------------- */
  const overRef = useRef<HTMLDivElement | null>(null);
  const overDrag = useRef<number | null>(null);
  const overAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = xToTime(e.clientX - r.left, 0, duration, r.width);
    const next = centerSelectionOn(selRef.current, t, duration);
    selRef.current = next;
    setSel(next);
    const v = viewAround(next, span, duration);
    viewRef.current = v;
    setViewStart(v);
    seek(Math.max(0, Math.min(t, duration)), true);
  };

  /* ---- keyboard ----------------------------------------------------- */
  const nudge = (which: "start" | "end", e: React.KeyboardEvent) => {
    const stepS = e.shiftKey ? 1 : 0.1;
    const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -stepS : e.key === "ArrowRight" || e.key === "ArrowUp" ? stepS : 0;
    if (!d) return;
    e.preventDefault();
    const next = which === "start" ? setStart(sel, sel.start + d, maxLen, duration) : setEnd(sel, sel.end + d, maxLen, duration);
    setSel(next);
    selRef.current = next;
    if (next.start < viewStart || next.end > viewStart + span) setViewStart(viewAround(next, span, duration));
    seek(which === "start" ? next.start : next.end);
    if (which === "start") void snapNow(next);
  };

  const len = sel.end - sel.start;
  const atMax = len >= maxLen - 0.05;
  const done = async () => {
    const s = await snapNow(selRef.current);
    onDone({ start: round2(s.start), end: round2(Math.min(duration, s.end)) });
  };
  const last = !step || step.index >= step.count;
  const xs = toX(sel.start);
  const xe = toX(sel.end);
  const note = !canEncode && maxLen < Math.min(limit, duration) - 0.5
    ? `This phone can't shrink video, so up to ${formatClock(maxLen)} of this one can go.`
    : `${VIDEO_LIMITS[context].label} can be up to ${formatClock(limit)}. Drag the ends to pick the part you want.`;
  const snapNote = snapStart ? " This phone can only cut this clip at certain frames, so the start may move back a moment." : "";

  return (
    <Dialog open onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent
        showBackButton={false}
        className="fixed inset-0 left-0 top-0 z-[60] flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white dark:bg-black sm:left-1/2 sm:top-1/2 sm:h-[min(96dvh,920px)] sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] outline-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === " " && !(e.target as HTMLElement).closest("button,[role=slider]")) {
            e.preventDefault();
            togglePlay();
          }
        }}
        data-video-trimmer
      >
        <DialogTitle className="sr-only">Trim video</DialogTitle>
        <DialogDescription className="sr-only">Drag the handles to choose the part of the video to post, then tap Done.</DialogDescription>

        {/* top bar */}
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
          <button type="button" onClick={() => onDone(null)} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Cancel">
            <X className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1 text-center text-[15px] font-black">{step && step.count > 1 ? `Clip ${step.index} of ${step.count}` : "Trim"}</div>
          <button type="button" onClick={() => void done()} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[15px] font-black text-black active:scale-95" data-trim-done>
            {last ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
            {last ? "Done" : "Next"}
          </button>
        </div>

        {/* preview: the whole picture, never cropped */}
        <div className="relative min-h-0 flex-1" onClick={togglePlay}>
          <video
            ref={(v) => {
              videoRef.current = v;
              if (v) {
                v.muted = muted;
                v.defaultMuted = true;
              }
            }}
            src={url}
            playsInline
            muted
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedMetadata={(e) => {
              setReady(true);
              const v = e.currentTarget;
              v.currentTime = selRef.current.start;
              void v.play().catch(() => setPlaying(false));
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setNoPreview(true)}
            data-trim-preview
          />
          {noPreview ? (
            <div className="absolute inset-0 grid place-items-center px-10 text-center text-[13px] leading-snug text-white/70" data-trim-no-preview>
              This browser can't play this video here, but you can still trim it by the times below.
            </div>
          ) : (
            !ready && <div className="absolute inset-0 grid place-items-center text-[13px] text-white/60">Loading video…</div>
          )}
          {ready && !playing && !dragging && (
            <span className="pointer-events-none absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 backdrop-blur" aria-hidden>
              <Play className="ml-1 h-8 w-8 fill-white text-white" />
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur active:scale-95"
            aria-label={muted ? "Sound on" : "Sound off"}
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>

        {/* timeline */}
        <div className="shrink-0 px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
          <div className="mb-2.5 flex items-baseline justify-center gap-1.5" aria-live="polite">
            <span className={cn("text-[17px] font-black tabular-nums", atMax && "text-amber-300")} data-trim-length>{formatClock(len)}</span>
            <span className="text-[13px] font-semibold text-white/55 tabular-nums">selected · {formatClock(maxLen)} max</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button type="button" onClick={togglePlay} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 active:scale-95" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="ml-0.5 h-5 w-5 fill-white" />}
            </button>
            <div className="relative min-w-0 flex-1">
              <div
                ref={setStripEl}
                className="relative touch-none select-none"
                style={{ height: TILE_H + 8 }}
                onPointerDown={onStripDown}
                onPointerMove={onStripMove}
                onPointerUp={onStripUp}
                onPointerCancel={onStripUp}
                data-no-swipe-back
                data-swipe-ignore
                data-trim-strip
              >
                {/* frames */}
                <div className="absolute inset-x-0 top-1 overflow-hidden rounded-md bg-white/10" style={{ height: TILE_H }}>
                  {detail.map((d) => {
                    const src = thumbs?.peek(d.t) ?? null;
                    return (
                      <div
                        key={d.at.toFixed(3)}
                        className="absolute top-0 h-full bg-zinc-800 bg-cover bg-center"
                        style={{ left: toX(d.at), width: Math.ceil((d.step / span) * stripW) + 1, backgroundImage: src ? `url(${src})` : undefined }}
                      />
                    );
                  })}
                  {/* outside the clip: dimmed */}
                  <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: Math.max(0, xs) }} />
                  <div className="absolute inset-y-0 right-0 bg-black/65" style={{ left: Math.min(stripW, xe) }} />
                </div>
                {/* the clip's frame + handles */}
                <div className="pointer-events-none absolute inset-y-0" style={{ left: xs - HANDLE_W, width: Math.max(0, xe - xs) + HANDLE_W * 2 }}>
                  <div className="absolute inset-x-[16px] top-0 h-[3px] bg-white" />
                  <div className="absolute inset-x-[16px] bottom-0 h-[3px] bg-white" />
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Start of clip"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(duration * 10) / 10}
                    aria-valuenow={Math.round(sel.start * 10) / 10}
                    aria-valuetext={formatClock(sel.start)}
                    onKeyDown={(e) => nudge("start", e)}
                    className="pointer-events-auto absolute inset-y-0 left-0 grid place-items-center rounded-l-lg bg-white outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    style={{ width: HANDLE_W }}
                    data-trim-handle="start"
                  >
                    <span className="h-5 w-[3px] rounded-full bg-black/70" />
                  </div>
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="End of clip"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(duration * 10) / 10}
                    aria-valuenow={Math.round(sel.end * 10) / 10}
                    aria-valuetext={formatClock(sel.end)}
                    onKeyDown={(e) => nudge("end", e)}
                    className="pointer-events-auto absolute inset-y-0 right-0 grid place-items-center rounded-r-lg bg-white outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    style={{ width: HANDLE_W }}
                    data-trim-handle="end"
                  >
                    <span className="h-5 w-[3px] rounded-full bg-black/70" />
                  </div>
                </div>
                {/* playhead */}
                <div ref={playheadRef} className="pointer-events-none absolute -top-0.5 left-0 h-[calc(100%+4px)] w-[3px] -translate-x-1/2 rounded-full bg-white opacity-0 shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
                {/* the exact time while a handle moves */}
                {(dragging === "start" || dragging === "end") && (
                  <span
                    className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-full bg-white px-2 py-0.5 text-[12px] font-black tabular-nums text-black shadow"
                    style={{ left: dragging === "start" ? xs : xe }}
                  >
                    {formatTenths(dragging === "start" ? sel.start : sel.end)}
                  </span>
                )}
              </div>
              {/* start / end under the handles */}
              <div className="relative mt-1 h-4 text-[11px] font-bold tabular-nums text-white/65">
                <span className="absolute -translate-x-1/2" style={{ left: Math.max(14, Math.min(stripW - 40, xs)) }}>{formatClock(sel.start)}</span>
                <span className="absolute -translate-x-1/2" style={{ left: Math.min(stripW - 14, Math.max(xs + 40, xe)) }}>{formatClock(sel.end)}</span>
              </div>
            </div>
          </div>

          {overview && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] font-bold text-white/50">
                <span>Whole video</span>
                <span className="tabular-nums">{formatClock(duration)}</span>
              </div>
              <div
                ref={overRef}
                className="relative h-8 touch-none select-none overflow-hidden rounded-md bg-white/10"
                onPointerDown={(e) => {
                  overDrag.current = e.pointerId;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  videoRef.current?.pause();
                  overAt(e);
                }}
                onPointerMove={(e) => overDrag.current === e.pointerId && overAt(e)}
                onPointerUp={() => {
                  overDrag.current = null;
                  seek(selRef.current.start);
                  play();
                  void snapNow(selRef.current).then((n) => seek(n.start));
                }}
                onPointerCancel={() => (overDrag.current = null)}
                aria-label="Whole video: drag to find the part you want"
                data-no-swipe-back
                data-swipe-ignore
                data-trim-overview
              >
                {overTiles.map((d) => {
                  const src = thumbs?.peek(d.t) ?? null;
                  return (
                    <div
                      key={d.at.toFixed(3)}
                      className="absolute top-0 h-full bg-zinc-800 bg-cover bg-center opacity-80"
                      style={{ left: `${(d.at / duration) * 100}%`, width: `calc(${(d.step / duration) * 100}% + 1px)`, backgroundImage: src ? `url(${src})` : undefined }}
                    />
                  );
                })}
                {/* the strip above's window, and the clip */}
                <div className="pointer-events-none absolute inset-y-0 border-x border-white/40 bg-white/10" style={{ left: `${(viewStart / duration) * 100}%`, width: `${(span / duration) * 100}%` }} />
                <div className="pointer-events-none absolute inset-y-0 rounded-[3px] border-2 border-white" style={{ left: `${(sel.start / duration) * 100}%`, width: `max(4px, ${((sel.end - sel.start) / duration) * 100}%)` }} />
              </div>
            </div>
          )}

          <p className="mt-3 text-center text-[12px] leading-snug text-white/55" data-trim-note>{note}{snapNote}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTenths(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/**
 * A picked clip playing just its selection, muted, round and round (the
 * studio's stage while you write the caption): what you see is what goes.
 */
export function TrimmedVideo({ src, trim, poster, className, style, ...rest }: { src: string; trim: VideoTrim | null | undefined; poster?: string; className?: string; style?: React.CSSProperties } & Record<`data-${string}`, string | boolean | undefined>) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const start = trim?.start ?? 0;
  const end = trim?.end ?? null;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const toStart = () => {
      try { v.currentTime = start; } catch { /* not seekable yet */ }
    };
    const onTime = () => {
      if ((end != null && v.currentTime >= end - 0.05) || v.currentTime < start - 0.25) toStart();
    };
    // the whole clip loops by itself; a selection loops back to its start
    const onEnded = () => {
      toStart();
      void v.play().catch(() => {});
    };
    if (v.readyState >= 1) toStart();
    v.addEventListener("loadedmetadata", toStart);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("loadedmetadata", toStart);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
    };
  }, [start, end, src]);
  return <video ref={ref} src={src} poster={poster} muted loop={end == null} autoPlay playsInline className={className} style={style} {...rest} />;
}
