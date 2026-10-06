import { useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCachedRatio, setCachedRatio, useMediaViewer } from "@/components/media-viewer";
import { playNativeFullscreen } from "@/lib/native-video-fullscreen";

function fmtClock(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

/** True once the element has come near the viewport (and stays true). */
function useNearViewport(ref: React.RefObject<Element | null>, enabled: boolean) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!enabled || near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, near]);
  return near;
}

/**
 * Video bubble, iMessage style: a still frame with a play button and the
 * duration. One tap plays it in the native full-screen player (iOS) or the
 * in-app viewer (elsewhere); there is no tiny inline player to expand by hand.
 *
 * New videos carry a small poster image + size + duration, so the bubble draws
 * instantly at the right shape and loads no video data. Older videos have
 * none; for those the first frame is read from the file, but only once the
 * bubble is near the screen.
 */
export function ChatVideoTile({
  src, poster, expectPoster, width, height, duration: knownDuration, cacheKey, name, className,
}: {
  /** Signed URL of the video; may still be loading. */
  src?: string;
  /** Signed URL of the poster image, when the video has one. */
  poster?: string;
  /** The video has a poster, but its link may still be loading: don't fall back to reading the video. */
  expectPoster?: boolean;
  width?: number;
  height?: number;
  duration?: number;
  /** Stable key (storage path) so legacy tiles reserve the right shape before metadata loads. */
  cacheKey?: string | null;
  name?: string | null;
  className?: string;
}) {
  const viewer = useMediaViewer();
  const ref = useRef<HTMLButtonElement>(null);
  const known = width && height ? width / height : null;
  const [ratio, setRatio] = useState<number>(() => known ?? getCachedRatio(cacheKey) ?? 3 / 4);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [ready, setReady] = useState(false);
  const legacy = !poster && !expectPoster;
  const near = useNearViewport(ref, legacy);

  const open = () => {
    if (!src) return;
    const fallback = () => viewer.open(src, { kind: "video", alt: name ?? "Video", previewSrc: poster });
    // Must run inside the tap: iOS only allows sound + fullscreen from a user gesture.
    if (!playNativeFullscreen(src, fallback)) fallback();
  };

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => { e.stopPropagation(); open(); }}
      aria-label={name ? `Play video ${name}` : "Play video"}
      aria-busy={!src || undefined}
      data-no-doubletap
      className={cn(
        "relative block w-[240px] max-w-full overflow-hidden rounded-md bg-black active:opacity-90",
        "max-h-80",
        className,
      )}
      style={{ aspectRatio: String(ratio) }}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={() => setReady(true)}
          className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity", ready ? "opacity-100" : "opacity-0")}
        />
      ) : near && src ? (
        <video
          src={src.includes("#") ? src : `${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              const r = v.videoWidth / v.videoHeight;
              setRatio(r);
              setCachedRatio(cacheKey, r);
            }
            setDuration(v.duration);
          }}
          onLoadedData={() => setReady(true)}
          className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity", ready ? "opacity-100" : "opacity-0")}
        />
      ) : null}
      {!ready && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted to-secondary/50" aria-hidden="true" />}
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur-sm">
          {src ? <Play className="h-5 w-5 translate-x-[1px] fill-current" /> : <Loader2 className="h-5 w-5 animate-spin" />}
        </span>
      </span>
      {duration > 0 && (
        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {fmtClock(duration)}
        </span>
      )}
    </button>
  );
}
