import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { releaseCanvas } from "@/lib/canvas-memory";
import { fitWithin } from "@/lib/video-poster";
import { GRID_ASPECT, focusPosition, type MediaFocus, type Size } from "@/lib/photo-frame";
import { FocusFramer } from "@/components/community/photo-framer";

/** A frame of a playing / seeked video in the page, as a JPEG (≤ `max` px long side). Null when the phone won't hand it over. */
function grabFrame(v: HTMLVideoElement, max: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!v.videoWidth || !v.videoHeight) return resolve(null);
    const { width, height } = fitWithin(v.videoWidth, v.videoHeight, max);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    try {
      const ctx = c.getContext("2d");
      if (!ctx) {
        releaseCanvas(c);
        return resolve(null);
      }
      ctx.drawImage(v, 0, 0, width, height);
      c.toBlob(
        (b) => {
          releaseCanvas(c);
          resolve(b);
        },
        "image/jpeg",
        0.86,
      );
    } catch {
      releaseCanvas(c);
      resolve(null);
    }
  });
}

/**
 * Edit cover, Instagram's way, for a clip on a post: slide through the clip
 * to the frame you want as its cover (what the feed shows before it plays,
 * and its tile on your profile grid), drag to choose which part shows where
 * the feed crops it, and see the grid tile as it'll look. Done hands back
 * that frame as a JPEG and the framing.
 */
export function CoverPicker({
  src,
  size,
  aspect,
  focus: initialFocus,
  onCancel,
  onDone,
}: {
  /** The clip (a local object URL). */
  src: string;
  /** Its size (px). */
  size: Size;
  /** The shape the feed shows it at. */
  aspect: number;
  focus: MediaFocus;
  onCancel: () => void;
  onDone: (cover: Blob | null, focus: MediaFocus) => void;
}) {
  const vid = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [t, setT] = useState(0);
  const [focus, setFocus] = useState(initialFocus);
  const [tile, setTile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!area || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setAreaSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(area);
    return () => ro.disconnect();
  }, [area]);
  const frame = useMemo(() => {
    const w = Math.min(areaSize.w, areaSize.h * aspect);
    return { w: Math.floor(w), h: Math.floor(w / aspect) };
  }, [areaSize, aspect]);

  // the small grid tile: a still of the frame you're on, refreshed when the slider stops
  const tileUrl = useRef<string | null>(null);
  const refreshTile = () => {
    const v = vid.current;
    if (!v) return;
    void grabFrame(v, 360).then((b) => {
      if (!b) return;
      if (tileUrl.current) URL.revokeObjectURL(tileUrl.current);
      tileUrl.current = URL.createObjectURL(b);
      setTile(tileUrl.current);
    });
  };
  useEffect(() => () => {
    if (tileUrl.current) URL.revokeObjectURL(tileUrl.current);
  }, []);

  // iPhones only draw a frame of a video that has played: a muted moment gets it going
  const attach = (v: HTMLVideoElement | null) => {
    vid.current = v;
    if (!v) return;
    v.muted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
  };
  const primed = useRef(false);
  const onMeta = () => {
    const v = vid.current;
    if (!v) return;
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    if (primed.current) return;
    primed.current = true;
    void v
      .play()
      .then(() => {
        v.pause();
        v.currentTime = 0;
      })
      .catch(() => undefined);
  };

  // follow the slider; the latest position wins (one seek at a time)
  const want = useRef(0);
  const seeking = useRef(false);
  const seek = (to: number) => {
    want.current = to;
    setT(to);
    const v = vid.current;
    if (!v || seeking.current) return;
    seeking.current = true;
    v.currentTime = to;
  };
  const onSeeked = () => {
    const v = vid.current;
    seeking.current = false;
    if (v && Math.abs(v.currentTime - want.current) > 0.05) {
      seeking.current = true;
      v.currentTime = want.current;
      return;
    }
    refreshTile();
  };

  const done = async () => {
    const v = vid.current;
    if (!v || busy) return;
    setBusy(true);
    const b = await grabFrame(v, 1080);
    setBusy(false);
    if (!b) toast.message("Couldn't grab that frame on this phone", { description: "The clip keeps its first frame as its cover." });
    onDone(b, focus);
  };

  const position = focusPosition(focus);
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black text-white" data-cover-picker>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2" style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}>
        <button type="button" onClick={onCancel} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 active:scale-95" aria-label="Cancel">
          <X className="h-6 w-6" />
        </button>
        <div className="flex-1 text-center text-[16px] font-black">Cover</div>
        <button type="button" onClick={() => void done()} disabled={busy} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-black text-primary-foreground active:scale-95 disabled:opacity-60" aria-label="Use this cover">
          <Check className="h-5 w-5" /> Done
        </button>
      </div>
      <div ref={setArea} className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="relative overflow-hidden rounded-2xl bg-zinc-900" style={{ width: frame.w, height: frame.h }}>
          {/* (the grid tile is shown for real below, not outlined here: a clip's tile shows more of its height than the feed does) */}
          <FocusFramer size={size} frame={frame} focus={focus} onFocus={setFocus}>
            <video
              ref={attach}
              src={src}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={onMeta}
              onSeeked={onSeeked}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={position ? { objectPosition: position } : undefined}
            />
          </FocusFramer>
        </div>
      </div>
      <div className="shrink-0 space-y-3 px-5 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}>
        <div className="flex items-center gap-3">
          {/* the grid tile, as your profile will show it */}
          <div className="relative shrink-0 overflow-hidden rounded-md bg-white/10 ring-1 ring-white/30" style={{ width: 48, height: 48 / GRID_ASPECT }} aria-label="Your profile grid's tile" data-cover-tile>
            {tile && <img src={tile} alt="" className="h-full w-full object-cover" style={position ? { objectPosition: position } : undefined} />}
          </div>
          <p className="min-w-0 text-[12px] leading-snug text-white/70">Slide to pick the frame people see before it plays and on your profile. Drag the clip to choose what shows.</p>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={Math.min(t, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-10 w-full accent-white"
          aria-label="Cover frame"
          disabled={!duration}
          data-no-frame
        />
      </div>
    </div>
  );
}
