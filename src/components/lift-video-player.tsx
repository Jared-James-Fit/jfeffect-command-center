import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Rewind, FastForward, Gauge, Maximize2, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function LiftVideoPlayer({ src, fallbackUrl }: { src: string; fallbackUrl?: string | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-black/40 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">Video could not load.</div>
        {fallbackUrl ? (
          <Button size="sm" variant="outline" asChild>
            <a href={fallbackUrl} target="_blank" rel="noreferrer">
              Open in Drive <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        ) : (
          <div className="text-xs text-muted-foreground">Try refreshing or re-uploading.</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative flex w-full items-center justify-center bg-black">
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <div className="text-xs">Loading video…</div>
          </div>
        )}
        <video
          ref={ref}
          src={src}
          controls
          playsInline
          controlsList="nodownload"
          preload="metadata"
          onLoadedData={() => setStatus("ready")}
          onCanPlay={() => setStatus("ready")}
          onError={() => setStatus("error")}
          className="mx-auto block max-h-[70vh] w-auto max-w-full"
          style={{ minHeight: status === "loading" ? "240px" : undefined }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1">
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
      </div>
    </div>
  );
}