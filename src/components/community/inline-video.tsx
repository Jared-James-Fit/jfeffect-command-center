import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullMediaUrl } from "@/lib/community.queries";
import { preferAmbientAudio } from "@/lib/audio-session";
import { SOUND_BLOCKED_EVENT, acquireFeedVideo, playFeedVideo, releaseFeedVideo, setSoundWanted, soundBlocked, unmuteBlocked } from "@/lib/video-pool";

/*
 * Sound in the feed: clips play with their sound by default. One speaker for
 * the visit (never saved: every open starts with sound): off keeps every clip
 * quiet until it's turned back on.
 *   "auto" (the default): sound on, on the page's "ambient" audio, so it
 *          follows the silent switch and plays over the person's music
 *          instead of stopping it (Instagram's feed).
 *   "on":   turned on with the speaker: plays through the silent switch.
 *   "off":  muted with the speaker.
 */
export type FeedSoundMode = "auto" | "on" | "off";
let feedSoundMode: FeedSoundMode = "auto";
const soundListeners = new Set<() => void>();
export function setFeedSound(on: boolean) {
  const next: FeedSoundMode = on ? "on" : "off";
  if (feedSoundMode === next) return;
  feedSoundMode = next;
  soundListeners.forEach((l) => l());
}
/** A tap on a clip where there's no full-screen viewer: sound off if it was on, on if it was off. */
export function toggleFeedSound() {
  setFeedSound(feedSoundMode === "off");
}
// a tap anywhere gives a clip the phone held quiet its sound, unless the speaker is off
setSoundWanted(() => feedSoundMode !== "off");
export function useFeedSoundMode(): FeedSoundMode {
  return useSyncExternalStore(
    (l) => {
      soundListeners.add(l);
      return () => soundListeners.delete(l);
    },
    () => feedSoundMode,
    () => "auto",
  );
}
export function useFeedSound(): boolean {
  return useFeedSoundMode() !== "off";
}

/*
 * The feed's clips hold still while something covers the whole feed (the
 * full-screen clips): a covered clip is still "on screen" to its observer.
 */
let feedHeld = 0;
const heldListeners = new Set<() => void>();
/** Hold every clip in the feed (returns the release). */
export function holdFeedVideos(): () => void {
  feedHeld += 1;
  heldListeners.forEach((l) => l());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    feedHeld -= 1;
    heldListeners.forEach((l) => l());
  };
}
function useFeedHeld(): boolean {
  return useSyncExternalStore(
    (l) => {
      heldListeners.add(l);
      return () => heldListeners.delete(l);
    },
    () => feedHeld > 0,
    () => false,
  );
}

/** Dispatched on a clip's box (`[data-inline-video]`): pause it, or play it again. */
export const CLIP_TOGGLE_EVENT = "jf-clip-toggle";

/** Autoplay is off for people who asked for less motion or less data: they tap to play. */
export function autoplayAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

/** On a post's screen, a clip shown whole sits between Crew's bar and the tab bar (what floats over the screen). */
const BETWEEN_BARS = { top: "var(--feed-bar-room, 0px)", bottom: "var(--feed-nav-room, 0px)" } as const;
/** Its poster the same (an image only stretches between top and bottom with a height of its own). */
const POSTER_BETWEEN_BARS = { top: "var(--feed-bar-room, 0px)", height: "calc(100% - var(--feed-bar-room, 0px) - var(--feed-nav-room, 0px))" } as const;

/**
 * A post's clip in the feed (and the post page): its poster first, then it
 * plays, with its sound (useFeedSoundMode) and looping, while at least 60%
 * of it is on screen, and pauses the moment it isn't (or its carousel slide
 * is swiped away, or the full-screen clips cover the feed). Its link is
 * ready with the feed page (usePostMediaUrls signs clips too); within two
 * screens it borrows one of the feed's video elements (video-pool.ts: an
 * iPhone allows sound only on an element first played from a tap, so the
 * elements are reused, never made per clip) and loads its header, within a
 * screen it buffers properly, so it's playing the moment it's on screen;
 * further away it gives the element back. A clip the phone wouldn't let make
 * sound yet plays muted (its speaker shows it) until the next tap anywhere.
 * `fit`: "contain" shows the whole clip at its own shape (the feed), "cover"
 * fills the frame, cropped to `position` (CSS object-position, from its
 * focus). The speaker button never opens anything; a tap on the clip itself
 * is the post card's (it opens the full-screen clips, or toggles the sound
 * where there are none, after the double-tap window so ❤️ still works).
 * `data-slide-path` says which clip.
 */
export function InlineVideo({
  path,
  poster,
  active = true,
  position,
  fit = "cover",
  controls = "bottom",
}: {
  path: string;
  poster: string | null;
  active?: boolean;
  position?: string;
  fit?: "cover" | "contain";
  /** Where its speaker sits: "top" on a post's own screen in the feed (its words and buttons are at the bottom). */
  controls?: "top" | "bottom";
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  // ever within two screens: its link; within two screens now: it holds an element
  const [near, setNear] = useState(false);
  const [inRange, setInRange] = useState(false);
  const [soon, setSoon] = useState(false);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // a tap on it paused it (on a post's own screen); scrolled away and back, it plays again
  const [userPaused, setUserPaused] = useState(false);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [auto] = useState(autoplayAllowed);
  const mode = useFeedSoundMode();
  const sound = mode !== "off";
  const held = useFeedHeld();
  // a carousel's next clip gets its link too, so a swipe to it starts at once
  const { data: url } = useFullMediaUrl(path, near);

  useEffect(() => {
    const box = wrap.current;
    if (!box || typeof IntersectionObserver === "undefined") {
      setNear(true);
      setInRange(true);
      setVisible(true);
      return;
    }
    // two screens away: the link and the clip's header; within a screen: buffer it (and keep it)
    const nearIo = new IntersectionObserver(
      ([e]) => {
        const hit = !!e?.isIntersecting;
        setInRange(hit);
        if (hit) setNear(true);
      },
      { rootMargin: "200% 0px" },
    );
    const soonIo = new IntersectionObserver(([e]) => setSoon((n) => n || !!e?.isIntersecting), { rootMargin: "100% 0px" });
    const seeIo = new IntersectionObserver(([e]) => setVisible(!!e && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    nearIo.observe(box);
    soonIo.observe(box);
    seeIo.observe(box);
    return () => {
      nearIo.disconnect();
      soonIo.disconnect();
      seeIo.disconnect();
    };
  }, []);

  // borrow an element while it's near, give it back when it isn't
  useLayoutEffect(() => {
    const h = host.current;
    if (!inRange || !url || !h) return;
    const v = acquireFeedVideo();
    v.className = "absolute inset-0 h-full w-full";
    v.muted = true;
    if (v.getAttribute("src") !== url) v.src = url;
    h.appendChild(v);
    setEl(v);
    const handlers: [string, () => void][] = [
      ["playing", () => setPlaying(true)],
      ["pause", () => setPlaying(false)],
      ["error", () => setFailed(true)],
      [SOUND_BLOCKED_EVENT, () => setBlocked(soundBlocked(v))],
    ];
    handlers.forEach(([k, f]) => v.addEventListener(k, f));
    return () => {
      handlers.forEach(([k, f]) => v.removeEventListener(k, f));
      releaseFeedVideo(v);
      setEl(null);
      setPlaying(false);
      setBlocked(false);
    };
  }, [inRange, url]);

  // its frame: whole (contain) or filled (cover, at its focus)
  useEffect(() => {
    if (!el) return;
    el.style.objectFit = fit === "contain" ? "contain" : "cover";
    el.style.objectPosition = position && fit === "cover" ? position : "";
  }, [el, fit, position]);

  // within a screen of being seen (and the slide that's showing): load it all, so it plays at once
  useEffect(() => {
    if (el) el.preload = soon && active && (auto || tapped) ? "auto" : "metadata";
  }, [el, soon, active, auto, tapped]);

  // playing by itself with sound: the page's "ambient" (silent switch, over their music);
  // turned on with the speaker: like any video (through the switch)
  useEffect(() => {
    if (!el) return;
    if (mode === "on") el.removeAttribute("data-ambient-audio");
    else el.setAttribute("data-ambient-audio", "");
  }, [el, mode]);

  // the post card asks for a pause / play with an event on this box (its tap is the card's: a double tap likes)
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const toggle = () => setUserPaused((p) => !p);
    box.addEventListener(CLIP_TOGGLE_EVENT, toggle);
    return () => box.removeEventListener(CLIP_TOGGLE_EVENT, toggle);
  }, []);
  useEffect(() => {
    if (!visible || !active) setUserPaused(false);
  }, [visible, active]);

  const shouldPlay = active && visible && !held && !userPaused && !!el && (auto || tapped) && !failed;
  useEffect(() => {
    if (!el) return;
    if (!shouldPlay) {
      el.pause();
      return;
    }
    if (mode === "auto") preferAmbientAudio();
    playFeedVideo(el, sound);
    // a speaker change while playing is handled below, never by restarting the clip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, el]);

  useEffect(() => {
    if (!el || soundBlocked(el)) return;
    if (sound && mode === "auto") preferAmbientAudio();
    el.muted = !sound;
  }, [el, sound, mode]);

  const soundOn = sound && !blocked;
  // on a post's screen (controls up top), shown whole: between the bars
  const between = controls === "top" && fit === "contain";
  return (
    <div ref={wrap} className="absolute inset-0 bg-black" data-inline-video={playing ? "playing" : "poster"} data-slide-path={path} data-fit={fit}>
      {/* on a post's screen a clip shown whole sits between Crew's bar and the tab bar; one that fills it runs under both */}
      <div ref={host} className="absolute inset-0" style={between ? BETWEEN_BARS : undefined} />
      {poster && (
        <img
          src={poster}
          alt=""
          draggable={false}
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-200",
            fit === "contain" ? "object-contain" : "object-cover",
            playing ? "opacity-0" : "opacity-100",
          )}
          style={between ? POSTER_BETWEEN_BARS : position && fit === "cover" ? { objectPosition: position } : undefined}
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
      {userPaused && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden data-clip-paused>
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/45 text-white">
            <Play className="ml-1 h-8 w-8 fill-current" />
          </span>
        </div>
      )}
      {(auto || tapped) && !failed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // turning it on: inside the tap (so the phone allows it), and through the
            // silent switch from now on (the attribute goes before the sound starts,
            // so the page's media watcher sees a clip someone asked to hear)
            if (!soundOn && el) {
              el.removeAttribute("data-ambient-audio");
              if (soundBlocked(el)) unmuteBlocked(el);
              else el.muted = false;
            }
            setFeedSound(!soundOn);
          }}
          className={cn(
            "absolute right-2.5 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur active:scale-90",
            controls === "top" ? "top-[calc(var(--feed-bar-room,0px)+3rem)]" : "bottom-2.5",
          )}
          aria-label={soundOn ? "Mute" : "Turn sound on"}
          aria-pressed={soundOn}
          data-video-sound
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
