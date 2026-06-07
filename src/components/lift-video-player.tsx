import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Rewind, FastForward, Gauge, Maximize2, Loader2, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
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
}: {
  src: string;
  fallbackUrl?: string | null;
  title?: string;
  embedFallbackUrl?: string | null;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [slow, setSlow] = useState(false);
  const [useEmbedFallback, setUseEmbedFallback] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setStatus("loading");
    setSlow(false);
    setUseEmbedFallback(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(slowTimer);
  }, [src, retryKey]);

  const skip = (delta: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
  };
  const setRate = (r: number) => {
    setSpeed(r);
    if (ref.current) ref.current.playbackRate = r;
  };
  const goFullscreen = () => {
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

  return (
    <div className="space-y-2">
      <div className={cn("relative mx-auto aspect-video w-full overflow-hidden rounded-md border border-border bg-secondary/40")}>
        {useEmbedFallback && embedFallbackUrl ? (
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
            aria-label={title}
            onLoadedData={() => setStatus("ready")}
            onCanPlay={() => setStatus("ready")}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              v.playbackRate = speed;
            }}
            onError={() => {
              if (embedFallbackUrl) {
                setUseEmbedFallback(true);
                setStatus("loading");
                setSlow(false);
              } else {
                setStatus("error");
              }
            }}
            className="h-full w-full object-contain"
          />
        )}
        {(status === "loading" || status === "error") && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-4 text-center">
            {status === "error" ? (
              <AlertTriangle className="h-6 w-6 text-muted-foreground" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            <div>
              <div className="text-sm font-medium">
                {status === "error" ? "Video preview could not load." : "Loading video…"}
              </div>
              {(slow || status === "error") && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {status === "error" ? "Video cannot be previewed. Open in Google Drive." : "Video is taking longer than expected."}
                </div>
              )}
            </div>
            {(slow || status === "error") && (
              <div className="flex flex-wrap justify-center gap-2">
                {fallbackUrl && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={fallbackUrl} target="_blank" rel="noreferrer">
                      Open in Drive <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={retry}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Retry
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
        <Button size="sm" variant="outline" onClick={goFullscreen} title="Fullscreen" className="ml-auto">
          <Maximize2 className="mr-1 h-3 w-3" /> Fullscreen
        </Button>
        {fallbackUrl && (
          <Button size="sm" variant="outline" asChild>
            <a href={fallbackUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3 w-3" /> Drive
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}