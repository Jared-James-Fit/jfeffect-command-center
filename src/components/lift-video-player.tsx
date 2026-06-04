import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Rewind, FastForward, Gauge } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function LiftVideoPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [speed, setSpeed] = useState(1);

  const skip = (delta: number) => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
  };
  const setRate = (r: number) => {
    setSpeed(r);
    if (ref.current) ref.current.playbackRate = r;
  };

  return (
    <div className="space-y-2">
      <video
        ref={ref}
        src={src}
        controls
        playsInline
        controlsList="nodownload"
        className="w-full bg-black"
      />
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
      </div>
    </div>
  );
}