import { useEffect, useState } from "react";
import { Loader2, RotateCcw, WifiOff } from "lucide-react";
import { usePlaybackSession } from "@/hooks/use-playback-session";
import { cn } from "@/lib/utils";
import { demoEmbedUrl } from "@/lib/demo-video";

export { demoEmbedUrl, warmDemoPlayer } from "@/lib/demo-video";

/** How long before a still-loading player offers a retry. */
export const DEMO_SLOW_MS = 10_000;

/**
 * One exercise demo player for the app: a spinner until the player is up, a
 * "Try again" if it stalls (or a clear note when offline), and sound that
 * plays through the iPhone silent switch while it's on screen.
 */
export function ExerciseDemoVideo({ url, title, className }: { url: string; title: string; className?: string }) {
  usePlaybackSession(true);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), DEMO_SLOW_MS);
    return () => window.clearTimeout(t);
  }, [url, attempt]);

  useEffect(() => {
    const on = () => {
      setOffline(false);
      // back online: try the player again straight away
      setAttempt((a) => a + 1);
    };
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div data-demo-video className={cn("relative aspect-video w-full overflow-hidden rounded-xl border bg-black", className)}>
      <iframe
        key={attempt}
        src={demoEmbedUrl(url)}
        title={title}
        onLoad={() => setLoaded(true)}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center bg-black px-6 text-center text-white" aria-live="polite">
          {offline ? (
            <div className="flex flex-col items-center gap-2 text-[13px] text-white/80">
              <WifiOff className="h-5 w-5" />
              You're offline. The demo plays as soon as you're back online.
            </div>
          ) : slow ? (
            <div className="flex flex-col items-center gap-2.5 text-[13px] text-white/80">
              The video is taking a while to load.
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-black active:scale-95"
              >
                <RotateCcw className="h-4 w-4" /> Try again
              </button>
            </div>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-white/70" aria-label="Loading video" />
          )}
        </div>
      )}
    </div>
  );
}
