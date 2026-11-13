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
/** A tap on a clip (Instagram's): sound off if it was on, on if it was off. Returns whether it's on now. */
export function toggleFeedSound(): boolean {
  setFeedSound(feedSoundMode === "off");
  return feedSoundMode !== "off";
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

/**
 * Dispatched on a clip's box (`[data-inline-video]`) as a CustomEvent<boolean>:
 * a finger held on it pauses it (true) until it lets go (false), Instagram's.
 */
export const CLIP_HOLD_EVENT = "jf-clip-hold";

/** Autoplay is off for people who asked for less motion or less data: they tap to play. */
export function autoplayAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}

/** On a post's screen (which ends at the tab bar), a clip shown whole sits under Crew's bar, between the bars; one that fills it runs up under Crew's bar. */
const BETWEEN_BARS = { top: "var(--feed-bar-room, 0px)" } as const;
/** Its poster the same (an image only stretches between top and bottom with a height of its own). */
const POSTER_BETWEEN_BARS = { top: "var(--feed-bar-room, 0px)", height: "calc(100% - var(--feed-bar-room, 0px))" } as const;

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
 * is the post card's (on a post's screen it turns the sound on or off,
 * Instagram's, so there's no speaker there; on the coach's feed of cards it
 * opens the full-screen clips; always after the double-tap window so ❤️
 * still works), and a finger held on it pauses it (CLIP_HOLD_EVENT).
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
  /**
   * Where its speaker sits: "top" on a post's own screen in the feed (its words
   * and buttons are at the bottom); "corner" in the small card above a post's
   * sheet (Instagram's: bottom right, the icon alone).
   */
  controls?: "top" | "bottom" | "corner";
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
  // a finger held on it (on a post's own screen): paused until it lets go
  const [holdPaused, setHoldPaused] = useState(false);
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

  // the post card holds it with an event on this box (its taps are the card's: one is the sound, two ❤️)
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const hold = (e: Event) => setHoldPaused((e as CustomEvent<boolean>).detail === true);
    box.addEventListener(CLIP_HOLD_EVENT, hold);
    return () => box.removeEventListener(CLIP_HOLD_EVENT, hold);
  }, []);
  useEffect(() => {
    if (!visible || !active) setHoldPaused(false);
  }, [visible, active]);

  const shouldPlay = active && visible && !held && !holdPaused && !!el && (auto || tapped) && !failed;
  const playingWanted = useRef(shouldPlay);
  playingWanted.current = shouldPlay;
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
    if (!sound) return;
    // turned on by a tap a moment ago (after the double-tap window): should the phone stop a clip
    // it won't let make sound yet, it plays again muted with "Tap for sound" (playFeedVideo)
    const t = window.setTimeout(() => {
      if (el.paused && playingWanted.current) playFeedVideo(el, true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [el, sound, mode]);

  const soundOn = sound && !blocked;
  // the phone is holding its sound back until a tap: say so, plainly (TikTok's "Tap for sound")
  const askTap = sound && blocked && controls !== "corner";
  // on a post's screen (controls up top), shown whole: between the bars
  const between = controls === "top" && fit === "contain";
  return (
    <div ref={wrap} className="absolute inset-0 bg-black" data-inline-video={playing ? "playing" : "poster"} data-slide-path={path} data-fit={fit}>
      {/* on a post's screen a clip shown whole sits between Crew's bar and the tab bar; one that fills it runs up under Crew's bar */}
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
      {/* on a post's screen the clip itself is the speaker (a tap, Instagram's): only "Tap for sound" shows there */}
      {(auto || tapped) && !failed && (controls !== "top" || askTap) && (
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
            "absolute right-2.5 flex h-8 items-center justify-center gap-1.5 rounded-full bg-black/55 text-white backdrop-blur active:scale-90",
            askTap ? "px-3 text-[13px] font-semibold" : "w-8",
            controls === "top" ? "top-[calc(var(--feed-bar-room,0px)+3rem)]" : "bottom-2.5",
          )}
          aria-label={soundOn ? "Mute" : "Turn sound on"}
          aria-pressed={soundOn}
          data-video-sound
          data-sound-held={askTap ? "" : undefined}
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 shrink-0" />}
          {askTap && <span>Tap for sound</span>}
        </button>
      )}
    </div>
  );
}
