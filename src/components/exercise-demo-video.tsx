import { useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw, WifiOff } from "lucide-react";
import { holdPlaybackSession } from "@/lib/audio-session";
import { quietAppSounds } from "@/lib/app-sounds";
import { clearDemoCrumb, markDemoPlaying, noteDemoExit } from "@/lib/demo-crumb";
import { cn } from "@/lib/utils";
import { demoEmbedUrl } from "@/lib/demo-video";

export { demoEmbedUrl, warmDemoPlayer } from "@/lib/demo-video";

/** How long before a still-loading player offers a retry. */
export const DEMO_SLOW_MS = 10_000;

/**
 * One exercise demo player for the app. It opens as a cover with a big Play:
 * the Vimeo / YouTube player (heavy, and the page's audio switch to
 * "playback" that lets it play through the silent switch) only start on that
 * tap, never just for opening the guide. Opening How To used to load the
 * player and take over the phone's audio at once (cutting the person's music
 * off), and that's when the iPhone app reloaded. The tap starts it with sound
 * (the app needs no second tap); a spinner until it's up, Try again if it
 * stalls, a note when offline.
 */
export function ExerciseDemoVideo({ url, title, className }: { url: string; title: string; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const release = useRef<(() => void) | null>(null);
  // still up (the quiet step is async: a demo closed in between never takes the audio)
  const active = useRef(false);

  // A new demo starts on its cover again.
  useEffect(() => {
    setPlaying(false);
  }, [url]);

  const start = () => {
    if (playing) return;
    setPlaying(true);
    active.current = true;
    markDemoPlaying(url);
    // UI sounds quiet first, then the page plays like a video app (through the silent switch)
    void quietAppSounds().finally(() => {
      if (active.current && !release.current) release.current = holdPlaybackSession();
    });
  };

  // Playback audio for as long as the player is up; noted for the reload report.
  useEffect(() => {
    if (!playing) return;
    const onHide = () => noteDemoExit("pagehide");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") noteDemoExit("background");
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      active.current = false;
      release.current?.();
      release.current = null;
      clearDemoCrumb();
    };
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    setLoaded(false);
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), DEMO_SLOW_MS);
    return () => window.clearTimeout(t);
  }, [playing, url, attempt]);

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

  if (!playing) {
    return (
      <button
        type="button"
        data-demo-video
        data-demo-cover
        onClick={start}
        aria-label={`Play ${title}`}
        className={cn(
          "group relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl border bg-black text-white",
          className,
        )}
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,255,255,0.10),transparent_60%)]" />
        <span className="relative flex flex-col items-center gap-2.5">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-lg transition-transform group-active:scale-95">
            <Play className="ml-1 h-7 w-7 fill-current" />
          </span>
          <span className="text-[13px] font-bold">{offline ? "You're offline" : "Play demo"}</span>
        </span>
      </button>
    );
  }

  return (
    <div data-demo-video className={cn("relative aspect-video w-full overflow-hidden rounded-xl border bg-black", className)}>
      <iframe
        key={attempt}
        src={demoEmbedUrl(url, { autoplay: true })}
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
