import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Rewind, FastForward, Gauge, Maximize2, Loader2, AlertTriangle, ExternalLink, RefreshCw, Download } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function LiftVideoPlayer({
  src,
  fallbackUrl,
  title = "Video",
  embedFallbackUrl,
  thumbnailUrl,
  initialOrientation,
  onPlaybackError,
}: {
  src: string;
  fallbackUrl?: string | null;
  title?: string;
  embedFallbackUrl?: string | null;
  thumbnailUrl?: string | null;
  initialOrientation?: "portrait" | "landscape" | "unknown";
  onPlaybackError?: (message: string) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [slow, setSlow] = useState(false);
  const [useEmbedFallback, setUseEmbedFallback] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [incompatible, setIncompatible] = useState(false);
  const [orientation, setOrientation] = useState<"portrait" | "landscape" | "unknown">(
    // Default to portrait (9:16) so the canvas is reserved instantly and the
    // UI doesn't visually "jump" while metadata loads. Real dimensions
    // (in onLoadedMetadata) refine this once known.
    initialOrientation ?? "portrait"
  );

  useEffect(() => {
    setStatus("loading");
    setSlow(false);
    setUseEmbedFallback(false);
    setIncompatible(false);
    // Show fallback prompt at 5s, hard-error at 10s so admin is never stuck.
    const slowTimer = window.setTimeout(() => setSlow(true), 5000);
    const errorTimer = window.setTimeout(() => {
      setStatus((s) => (s === "loading" ? "error" : s));
    }, 10000);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(errorTimer);
    };
  }, [src, retryKey]);

  // Pre-check: many client uploads from iPhone are .mov / HEVC. Chrome and
  // Firefox on desktop can fetch metadata (so scrubbing appears to work) but
  // cannot decode frames, so play() silently no-ops. Detect that up front and
  // surface a clear download/open-original CTA instead of an inert player.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const probe = document.createElement("video");
    const lower = src.toLowerCase();
    const looksMov = /\.mov($|\?)/i.test(lower) || /\.qt($|\?)/i.test(lower);
    const canMov = probe.canPlayType("video/quicktime");
    const canHevcMp4 = probe.canPlayType('video/mp4; codecs="hvc1"') || probe.canPlayType('video/mp4; codecs="hev1"');
    if (looksMov && !canMov && !canHevcMp4) {
      setIncompatible(true);
    } else {
      setIncompatible(false);
    }
  }, [src]);

  const skip = (delta: number) => {
    if (useEmbedFallback) return;
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
  };
  const setRate = (r: number) => {
    setSpeed(r);
    if (useEmbedFallback) return;
    if (ref.current) ref.current.playbackRate = r;
  };
  const goFullscreen = () => {
    if (useEmbedFallback) return;
    const v = ref.current as any;
    if (!v) return;
    const fn = v.requestFullscreen || v.webkitEnterFullscreen || v.webkitRequestFullscreen;
    if (fn) fn.call(v);
  };
  const retry = () => {
    const v = ref.current;
    setRetryKey((k) => k + 1);
    setSlow(false);
    setUseEmbedFallback(false);
    setStatus("loading");
    if (v) {
      v.load();
    }
  };

  // Stable container aspect, capped height so it never dominates mobile.
  // Portrait clamps width too so it stays nicely centered on phones/tablets.
  const aspectClass =
    orientation === "landscape"
      ? "aspect-video w-full"
      : "aspect-[9/16] max-h-[70vh] w-auto max-w-[min(100%,calc(70vh*9/16))] mx-auto";

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative mx-auto overflow-hidden rounded-md border border-border bg-black",
          aspectClass
        )}
        style={
          thumbnailUrl && status !== "ready"
            ? {
                backgroundImage: `url(${thumbnailUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {incompatible ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 p-4 text-center text-white">
            <AlertTriangle className="h-6 w-6" />
            <div>
              <div className="text-sm font-medium">This video can't play in your browser.</div>
              <div className="mt-1 text-xs text-white/70">
                The client uploaded a QuickTime / HEVC file (iPhone default). Open it in Drive,
                or download and play in QuickTime / VLC.
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {fallbackUrl && (
                <Button size="sm" asChild>
                  <a href={fallbackUrl} target="_blank" rel="noreferrer">
                    Watch in Drive <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
              <Button size="sm" variant="secondary" asChild>
                <a href={src} download>
                  <Download className="mr-1 h-3 w-3" /> Download
                </a>
              </Button>
            </div>
          </div>
        ) : useEmbedFallback && embedFallbackUrl ? (
          <iframe
            key={`${embedFallbackUrl}-${retryKey}`}
            src={embedFallbackUrl}
            className="h-full w-full bg-secondary/40"
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            loading="lazy"
            title={title}
            onLoad={() => setStatus("ready")}
          />
        ) : (
          <video
            key={`${src}-${retryKey}`}
            ref={ref}
            src={src}
            controls
            playsInline
            controlsList="nodownload"
            preload="metadata"
            poster={thumbnailUrl ?? undefined}
            aria-label={title}
            onLoadedData={() => setStatus("ready")}
            onCanPlay={() => setStatus("ready")}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.playbackRate = speed;
              // Detect orientation from real video dimensions so the box
              // doesn't visually "jump" — we reserved aspect-video first.
              if (v.videoWidth && v.videoHeight) {
                setOrientation(v.videoHeight > v.videoWidth ? "portrait" : "landscape");
              }
              // iOS Safari with preload="metadata" often never fires
              // `canplay` until user interaction — flip ready as soon as
              // metadata is decoded so the "Loading preview…" overlay
              // clears and the poster/controls are visible immediately.
              setStatus("ready");
            }}
            onError={(event) => {
              const media = event.currentTarget;
              const code = media.error?.code;
              const message = code === MediaError.MEDIA_ERR_NETWORK
                ? "Playback blocked by network/CORS or the signed URL expired."
                : code === MediaError.MEDIA_ERR_DECODE
                  ? "Unsupported video format or codec for this device."
                  : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                    ? "Video source is not playable in this browser."
                    : code === MediaError.MEDIA_ERR_ABORTED
                      ? "Playback was aborted."
                      : "Unknown playback error.";
              onPlaybackError?.(message);
              if (embedFallbackUrl) {
                setUseEmbedFallback(true);
                setStatus("loading");
                setSlow(false);
              } else {
                setStatus("error");
              }
            }}
            className="h-full w-full bg-black object-contain"
          />
        )}
        {(status === "loading" || status === "error") && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 p-4 text-center text-white">
            {status === "error" ? (
              <AlertTriangle className="h-6 w-6" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            <div>
              <div className="text-sm font-medium">
                {status === "error" ? "Preview unavailable." : "Loading preview…"}
              </div>
              {(slow || status === "error") && (
                <div className="mt-1 text-xs text-white/70">
                  {status === "error" ? "Watch the original in Google Drive." : "Taking longer than expected — you can watch in Drive."}
                </div>
              )}
            </div>
            {(slow || status === "error") && (
              <div className="flex flex-wrap justify-center gap-2">
                {fallbackUrl && (
                  <Button size="sm" asChild>
                    <a href={fallbackUrl} target="_blank" rel="noreferrer">
                      Watch in Drive <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={retry}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Retry Preview
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
        <Button size="sm" variant="outline" onClick={() => skip(-5)} title="Back 5s">
          <Rewind className="mr-1 h-3 w-3" /> -5s
        </Button>
        <Button size="sm" variant="outline" onClick={() => skip(5)} title="Forward 5s">
          <FastForward className="mr-1 h-3 w-3" /> +5s
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Gauge className="mr-1 h-3 w-3" /> {speed}x
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {SPEEDS.map((s) => (
              <DropdownMenuItem key={s} onClick={() => setRate(s)}>
                {s}x{s === speed ? " ✓" : ""}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="outline" onClick={goFullscreen} title="Fullscreen" className="ml-auto" disabled={useEmbedFallback}>
          <Maximize2 className="mr-1 h-3 w-3" /> Fullscreen
        </Button>
        {fallbackUrl && (
          <Button size="sm" asChild>
            <a href={fallbackUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3 w-3" /> Watch in Drive
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}