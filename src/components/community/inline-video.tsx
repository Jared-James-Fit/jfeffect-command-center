import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullMediaUrl } from "@/lib/community.queries";

/*
 * Sound in the feed, Instagram's way: clips start muted, the speaker turns
 * sound on, and it stays on for every clip after it until it's turned off.
 * One setting for the visit (never saved: every open starts quiet).
 */
let feedSound = false;
const soundListeners = new Set<() => void>();
export function setFeedSound(on: boolean) {
  if (feedSound === on) return;
  feedSound = on;
  soundListeners.forEach((l) => l());
}
export function useFeedSound(): boolean {
  return useSyncExternalStore(
    (l) => {
      soundListeners.add(l);
      return () => soundListeners.delete(l);
    },
    () => feedSound,
    () => false,
  );
}

/** Autoplay is off for people who asked for less motion or less data: they tap to play. */
export function autoplayAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

/**
 * A post's clip in the feed (and the post page): its poster first, then it
 * plays, muted and looping, while at least 60% of it is on screen, and pauses
 * the moment it isn't (or its carousel slide is swiped away). The video file
 * is only asked for when the clip comes near the screen, and only its header
 * loads until it plays. The speaker button never opens the post.
 */
export function InlineVideo({ path, poster, active = true }: { path: string; poster: string | null; active?: boolean }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [auto] = useState(autoplayAllowed);
  const sound = useFeedSound();
  const { data: url } = useFullMediaUrl(path, near && active);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      setVisible(true);
      return;
    }
    const nearIo = new IntersectionObserver(([e]) => setNear((n) => n || !!e?.isIntersecting), { rootMargin: "600px 0px" });
    const seeIo = new IntersectionObserver(([e]) => setVisible(!!e && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    nearIo.observe(el);
    seeIo.observe(el);
    return () => {
      nearIo.disconnect();
      seeIo.disconnect();
    };
  }, []);

  const shouldPlay = active && visible && !!url && (auto || tapped) && !failed;
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (shouldPlay) {
      v.play().catch(() => {
        // sound without a tap first: the phone said no, so it plays muted
        if (!v.muted) {
          setFeedSound(false);
          v.muted = true;
          void v.play().catch(() => {});
        }
      });
    } else v.pause();
  }, [shouldPlay, url]);

  useEffect(() => {
    if (vid.current) vid.current.muted = !sound;
  }, [sound]);

  // iPhone only autoplays inline when muted + playsinline are on the element itself
  const attach = useCallback((v: HTMLVideoElement | null) => {
    vid.current = v;
    if (!v) return;
    v.muted = !feedSound;
    if (!feedSound) v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0 bg-black" data-inline-video={playing ? "playing" : "poster"}>
      {url && (
        <video
          ref={attach}
          src={url}
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
        />
      )}
      {poster && (
        <img
          src={poster}
          alt=""
          draggable={false}
          className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200", playing ? "opacity-0" : "opacity-100")}
        />
      )}
      {!auto && !tapped && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTapped(true);
          }}
          className="absolute inset-0 grid place-items-center bg-black/10"
          aria-label="Play video"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
            <Play className="ml-0.5 h-6 w-6 fill-current" />
          </span>
        </button>
      )}
      {(auto || tapped) && !failed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setFeedSound(!sound);
          }}
          className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur active:scale-90"
          aria-label={sound ? "Mute" : "Turn sound on"}
          aria-pressed={sound}
          data-video-sound
        >
          {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
