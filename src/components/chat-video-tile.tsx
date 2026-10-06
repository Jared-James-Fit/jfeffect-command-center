import { useState } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCachedRatio, setCachedRatio, useMediaViewer } from "@/components/media-viewer";

function fmtClock(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "";
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}

/**
 * Video bubble, iMessage style: a still frame with a play button and the
 * duration. One tap opens it full screen and starts playing; no tiny inline
 * player to expand by hand.
 */
export function ChatVideoTile({
  src, cacheKey, name, className,
}: {
  src: string;
  /** Stable key (storage path) so the tile reserves the right shape before metadata loads. */
  cacheKey?: string | null;
  name?: string | null;
  className?: string;
}) {
  const viewer = useMediaViewer();
  const [ratio, setRatio] = useState<number>(() => getCachedRatio(cacheKey) ?? 3 / 4);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        viewer.open(src, { kind: "video", alt: name ?? "Video" });
      }}
      aria-label={name ? `Play video ${name}` : "Play video"}
      data-no-doubletap
      className={cn(
        "relative block w-[240px] max-w-full overflow-hidden rounded-md bg-black active:opacity-90",
        "max-h-80",
        className,
      )}
      style={{ aspectRatio: String(ratio) }}
    >
      {/* First frame as the poster. #t=0.1 makes iOS paint a frame without playing. */}
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
      {!ready && <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted to-secondary/50" aria-hidden="true" />}
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/30 backdrop-blur-sm">
          <Play className="h-5 w-5 translate-x-[1px] fill-current" />
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
