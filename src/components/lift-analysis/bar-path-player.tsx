/**
 * A set video with its bar path drawn over it: the rep on screen as a bright
 * trail that follows the plate as it plays, earlier reps faint, the plate's
 * spot, the sticking point, and the bar's speed right now. Plays at full,
 * half or quarter speed and steps a frame at a time; a rep's chip jumps to
 * it. In pick mode it asks for a tap on the end of the bar instead (with any
 * circles the engine found ringed as suggestions).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { cn } from "@/lib/utils";

type Rect = { ox: number; oy: number; dw: number; dh: number };

export type PickSuggestion = { t: number; fx: number; fy: number; fr: number };

const SPEEDS = [1, 0.5, 0.25] as const;

export function repSpan(a: LiftAnalysis, i: number): { start: number; end: number } | null {
  const r = a.reps[i];
  if (!r) return null;
  const s = Math.min(r.con.start, r.ecc?.start ?? Infinity);
  const e = Math.max(r.con.end, r.ecc?.end ?? -Infinity);
  return { start: s, end: e };
}

/** Which rep a moment belongs to (the one it's in, else the last one before it). */
export function repAt(a: LiftAnalysis, t: number): number {
  let best = -1;
  for (let i = 0; i < a.reps.length; i++) {
    const sp = repSpan(a, i);
    if (!sp) continue;
    if (t >= sp.start - 0.25) best = i;
  }
  return best;
}

function valueAt(t: number[], arr: (number | null)[], at: number): number | null {
  if (!t.length) return null;
  let lo = 0;
  let hi = t.length - 1;
  if (at <= t[0]) return arr[0];
  if (at >= t[hi]) return arr[hi];
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] <= at) lo = m;
    else hi = m;
  }
  const a = arr[lo];
  const b = arr[hi];
  if (a == null || b == null) return a ?? b;
  const f = (at - t[lo]) / (t[hi] - t[lo] || 1);
  return a + (b - a) * f;
}

function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export function BarPathPlayer({
  src,
  poster,
  analysis,
  selectedRep,
  onSelectRep,
  pick,
  className,
}: {
  src?: string;
  poster?: string;
  analysis?: LiftAnalysis | null;
  selectedRep: number | null;
  onSelectRep: (i: number | null) => void;
  /** Ask for a tap on the plate instead of showing the path. */
  pick?: {
    suggestions: PickSuggestion[];
    onPick: (t: number, fx: number, fy: number) => void;
  } | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof SPEEDS)[number]>(1);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);
  const timeRef = useRef(0);
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
    if (pick) {
      // suggestions: the circles the engine found, to tap
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      for (const s of pick.suggestions) {
        const [x, y] = P(s.fx, s.fy);
        ctx.beginPath();
        ctx.arc(x, y, s.fr * r.dw, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      return;
    }
    const a = analysis;
    if (!a) return;
    const S = a.series;
    const current = selectedRep ?? repAt(a, now);
    const line = (
      from: number,
      to: number,
      upTo: number,
      style: { w: number; color: string; shadow?: boolean },
    ) => {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const paths: [number, number][][] = [];
      let cur: [number, number][] = [];
      for (let i = 0; i < S.t.length; i++) {
        if (S.t[i] < from || S.t[i] > to || S.t[i] > upTo) continue;
        if (!S.ok[i]) {
          if (cur.length) paths.push(cur);
          cur = [];
          continue;
        }
        cur.push(P(S.x[i], S.y[i]));
      }
      if (cur.length) paths.push(cur);
      for (const pass of style.shadow ? [0, 1] : [1]) {
        ctx.lineWidth = pass === 0 ? style.w + 3 : style.w;
        ctx.strokeStyle = pass === 0 ? "rgba(0,0,0,0.55)" : style.color;
        for (const p of paths) {
          if (p.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(p[0][0], p[0][1]);
          for (let k = 1; k < p.length; k++) ctx.lineTo(p[k][0], p[k][1]);
          ctx.stroke();
        }
      }
    };
    a.reps.forEach((rep, i) => {
      const sp = repSpan(a, i);
      if (!sp) return;
      if (i === current) {
        // the rep on screen: drawn as far as the video has got (all of it when it's selected and paused past it)
        const upTo = selectedRep === i && !playing && now < sp.start ? sp.end : now;
        line(sp.start, sp.end, upTo, { w: 3, color: "#ffffff", shadow: true });
        if (rep.sticking && rep.sticking.time <= upTo) {
          const sx = valueAt(S.t, S.x, rep.sticking.time);
          const sy = valueAt(S.t, S.y, rep.sticking.time);
          if (sx != null && sy != null) {
            const [x, y] = P(sx, sy);
            ctx.fillStyle = "#f59e0b";
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else if (sp.end <= now || selectedRep != null) {
        line(sp.start, sp.end, Infinity, { w: 2, color: "rgba(255,255,255,0.35)" });
      }
    });
    // the plate's spot now
    if (now >= S.t[0] && now <= S.t[S.t.length - 1]) {
      const x = valueAt(S.t, S.x, now);
      const y = valueAt(S.t, S.y, now);
      if (x != null && y != null) {
        const [px, py] = P(x, y);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [analysis, pick, playing, rect, selectedRep]);

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
      draw();
    };
    v.addEventListener("seeked", sync);
    v.addEventListener("timeupdate", sync);
    v.addEventListener("loadeddata", sync);
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
      ro?.disconnect();
    };
  }, [draw, src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // a picked rep: show it from just before it starts
  useEffect(() => {
    const v = videoRef.current;
    if (!v || selectedRep == null || !analysis) return;
    const sp = repSpan(analysis, selectedRep);
    if (!sp) return;
    v.pause();
    try {
      v.currentTime = Math.max(0, sp.start - 0.25);
    } catch {
      /* not seekable yet */
    }
  }, [selectedRep, analysis]);

  // pick mode: pause where the engine saw the plate best (or keep the frame shown)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !pick) return;
    v.pause();
    const t = pick.suggestions[0]?.t;
    if (t != null) {
      try {
        v.currentTime = t;
      } catch {
        /* not seekable yet */
      }
    }
  }, [pick]);

  const step = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir / fps));
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (selectedRep != null) onSelectRep(null);
      void v.play().catch(() => {});
    } else v.pause();
  };

  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pick) return;
    const r = rect();
    const box = boxRef.current;
    if (!r || !box) return;
    const b = box.getBoundingClientRect();
    const fx = (e.clientX - b.left - r.ox) / r.dw;
    const fy = (e.clientY - b.top - r.oy) / r.dh;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    pick.onPick(videoRef.current?.currentTime ?? 0, fx, fy);
  };

  const liveV =
    analysis && analysis.units === "mm" && !pick
      ? valueAt(analysis.series.t, analysis.series.v, time)
      : null;

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        ref={boxRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-black",
          pick && "cursor-crosshair",
        )}
        onClick={onTap}
        data-bar-path-player
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
            // open on the set itself (the clip is never cut: everything before it is still there)
            const v = e.currentTarget;
            if (analysis && v.currentTime < 0.05 && analysis.window.start > 0.3) {
              try {
                v.currentTime = analysis.window.start;
              } catch {
                /* not seekable yet */
              }
            }
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
        {pick && (
          <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1.5 text-[13px] font-semibold text-white">
            Tap the end of the bar (the plate)
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] tabular-nums text-white/90">
          {clock(time)}
        </div>
      </div>
      <div className="flex items-center gap-1 px-2 py-1.5">
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
        {analysis && !pick && analysis.reps.length > 0 && (
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
