import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIP_ZOOM_MAX_TRIM, photoZoomBox, type ClipFrame } from "@/lib/photo-frame";
import { ClipFrameBox } from "@/components/community/clip-frame-box";
import { useFullMediaUrl } from "@/lib/community.queries";
import { preferAmbientAudio } from "@/lib/audio-session";
import {
  PLAY_REFUSED_EVENT,
  SOUND_BLOCKED_EVENT,
  acquireFeedVideo,
  pauseFeedVideo,
  playFeedVideo,
  playRefused,
  releaseFeedVideo,
  setRefusedClock,
  setSoundWanted,
  soundBlocked,
  startRefused,
  unmuteBlocked,
} from "@/lib/video-pool";
import { clipIsSilent, type SilentProbe } from "@/lib/video-silent";
import { VideoScrubber } from "@/components/community/video-scrubber";
import { ActivitySpinner } from "@/components/activity-spinner";
import { keepPlaying } from "@/lib/video-keep-playing";
import { startDecodedClip, type DecodedClip } from "@/lib/decoded-clip";
import { noteAutoplayRefused } from "@/lib/autoplay-notice";

/** Decoding hasn't shown a frame this long: the play button shows meanwhile (it goes once a frame is up). */
export const DECODED_SLOW_MS = 2500;

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

/**
 * On a post's screen (which ends at the tab bar), a clip shown whole sits
 * between Crew's bar and the post's words (TikTok's: they never cover it);
 * one that fills the screen runs up under Crew's bar and under the words.
 */
const BETWEEN_BARS = { top: "var(--feed-bar-room, 0px)", bottom: "var(--feed-words-room, 0px)" } as const;
/** Its poster the same (an image only stretches between top and bottom with a height of its own). */
const POSTER_BETWEEN_BARS = {
  top: "var(--feed-bar-room, 0px)",
  height: "calc(100% - var(--feed-bar-room, 0px) - var(--feed-words-room, 0px))",
} as const;

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
  frame = null,
  media = null,
  focusY = 0.5,
  warm,
}: {
  path: string;
  poster: string | null;
  active?: boolean;
  position?: string;
  fit?: "cover" | "contain";
  /**
   * Framed in the studio (ClipFrame): it shows as its frame, whole or filling
   * per `fit`, just the part that was framed (ClipFrameBox); its poster is
   * already that frame. `media` is the clip's own shape (w / h).
   */
  frame?: ClipFrame | null;
  media?: number | null;
  /** Which part of a clip zoomed to the room's width stays (0 its top, 1 its bottom): its focus, else the middle. */
  focusY?: number;
  /**
   * The slide next to the one showing in a carousel: while its post is on
   * screen it keeps (or borrows) its element, so a swipe to it plays at once
   * ("next" also loads ahead) and a swipe back carries on where it was,
   * instead of starting cold on its poster every time.
   */
  warm?: "next" | "prev";
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
  // it has shown a frame of its own (played, or been scrubbed to one): its poster stays away, even paused
  const [shown, setShown] = useState(false);
  // a finger on its bar (VideoScrubber): it holds still until it lets go, then plays on if it was playing
  const [scrubbing, setScrubbing] = useState(false);
  const [failed, setFailed] = useState(false);
  // waiting on data for a moment: a quiet spinner (never a frame that just sits there)
  const [buffering, setBuffering] = useState(false);
  // a carousel neighbour's post is on screen (at least half of it)
  const [postUp, setPostUp] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // the phone won't start it by itself, even muted (Low Power Mode): it plays from its own decoded frames on a
  // canvas in the element's place, muted (decoded-clip.ts), and the next tap hands it to the element with its sound;
  // only where that can't run, a play button
  const [refused, setRefused] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  const [decodedOn, setDecodedOn] = useState(false);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [decodeSlow, setDecodeSlow] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clipRef = useRef<DecodedClip | null>(null);
  // where the decoded clip is (a hold, a swipe away and back, the tap that hands it to the element carry on from here)
  const decodedAt = useRef(0);
  // no sound track (posted with no sound): no speaker, no "Tap for sound"
  const [silent, setSilent] = useState(false);
  // a finger held on it (on a post's own screen): paused until it lets go
  const [holdPaused, setHoldPaused] = useState(false);
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const [auto] = useState(autoplayAllowed);
  const mode = useFeedSoundMode();
  const sound = mode !== "off";
  const held = useFeedHeld();
  // a carousel's neighbours (while their post is on screen) hold an element and their link too
  const warmNow = !!warm && postUp;
  const holding = inRange || warmNow;
  const { data: url } = useFullMediaUrl(path, near || warmNow);

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

  // a slide off to the side is clipped by its carousel, so its own box never reads as near:
  // a neighbour asks whether the carousel (its post) is on screen instead
  useEffect(() => {
    const track = warm ? (wrap.current?.closest("[data-carousel]") as HTMLElement | null) : null;
    if (!track || typeof IntersectionObserver === "undefined") {
      setPostUp(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setPostUp(!!e && e.intersectionRatio >= 0.5), { threshold: [0, 0.5, 1] });
    io.observe(track);
    return () => io.disconnect();
  }, [warm]);

  // borrow an element while it's near, give it back when it isn't
  useLayoutEffect(() => {
    const h = host.current;
    if (!holding || !url || !h) return;
    const v = acquireFeedVideo();
    v.className = "absolute inset-0 h-full w-full";
    v.muted = true;
    if (v.getAttribute("src") !== url) v.src = url;
    h.appendChild(v);
    setEl(v);
    const readSound = () => {
      const s = clipIsSilent(v as unknown as SilentProbe);
      if (s != null) setSilent(s);
    };
    const handlers: [string, () => void][] = [
      [
        "playing",
        () => {
          setPlaying(true);
          setShown(true);
          // a tap started the element: it takes over from the decoded copy
          setLowPower(false);
        },
      ],
      // started from a tap: the decoded copy holds its frame until the element's first one is up
      ["play", () => clipRef.current?.stop()],
      ["pause", () => setPlaying(false)],
      // scrubbed while paused: the frame it's on is what shows (once there is one to show)
      ["seeked", () => v.readyState >= 2 && setShown(true)],
      [SOUND_BLOCKED_EVENT, () => setBlocked(soundBlocked(v))],
      [PLAY_REFUSED_EVENT, () => setRefused(playRefused(v))],
      ["loadedmetadata", readSound],
      ["timeupdate", readSound],
    ];
    handlers.forEach(([k, f]) => v.addEventListener(k, f));
    readSound();
    return () => {
      handlers.forEach(([k, f]) => v.removeEventListener(k, f));
      releaseFeedVideo(v);
      setEl(null);
      setPlaying(false);
      setShown(false);
      setBlocked(false);
      setRefused(false);
      setLowPower(false);
      setDecodeFailed(false);
      setSilent(false);
      setBuffering(false);
    };
  }, [holding, url]);

  // its frame: whole (contain) or filled (cover, at its focus); framed in the studio, its own box is the whole clip
  const framed = !!frame;
  useEffect(() => {
    if (!el) return;
    el.style.objectFit = framed ? "cover" : fit === "contain" ? "contain" : "cover";
    el.style.objectPosition = position && fit === "cover" && !framed ? position : "";
  }, [el, fit, position, framed]);

  // within a screen of being seen (and the slide that's showing, or the one a swipe brings next): load it all,
  // so it plays at once
  useEffect(() => {
    if (el) el.preload = ((soon && active) || (warmNow && warm === "next")) && (auto || tapped) ? "auto" : "metadata";
  }, [el, soon, active, auto, tapped, warmNow, warm]);

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

  const shouldPlay = active && visible && !held && !holdPaused && !scrubbing && !!el && (auto || tapped) && !failed;
  const playingWanted = useRef(shouldPlay);
  playingWanted.current = shouldPlay;
  const soundRef = useRef(sound);
  soundRef.current = sound;

  // stopped by the phone (the app away and back, a call, an audio change), stuck loading, or a dropped
  // connection: played again where it was, never left frozen on a frame (video-keep-playing.ts)
  useEffect(() => {
    if (!el) return;
    return keepPlaying(el, {
      wanted: () => playingWanted.current,
      // with its sound when it had it: a phone that holds it back plays it muted with "Tap for sound" (playFeedVideo)
      resume: () => playFeedVideo(el, soundRef.current),
      onWaiting: setBuffering,
      onFailed: () => setFailed(true),
    });
  }, [el]);
  useEffect(() => {
    if (!el) return;
    if (!shouldPlay) {
      // no tap will start it while it isn't wanted
      pauseFeedVideo(el);
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

  // refused by the phone (Low Power Mode): from now until a tap starts the element, it plays decoded
  useEffect(() => {
    if (refused) setLowPower(true);
  }, [refused]);
  // the canvas in the element's place: the element's own box and fit, so it shows exactly what the element would
  useEffect(() => {
    const h = host.current;
    if (!lowPower || !el || !h || decodeFailed) return;
    const c = document.createElement("canvas");
    c.className = el.className;
    c.style.objectFit = el.style.objectFit;
    c.style.objectPosition = el.style.objectPosition;
    c.style.pointerEvents = "none";
    c.setAttribute("data-decoded-clip", "");
    h.appendChild(c);
    canvasRef.current = c;
    setRefusedClock(el, () => clipRef.current?.time() ?? decodedAt.current);
    return () => {
      clipRef.current?.stop();
      clipRef.current = null;
      setRefusedClock(el, null);
      c.remove();
      canvasRef.current = null;
      setDecodedOn(false);
      setDecodeSlow(false);
    };
  }, [lowPower, el, decodeFailed]);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !el) return;
    c.style.objectFit = el.style.objectFit;
    c.style.objectPosition = el.style.objectPosition;
  }, [el, fit, position, framed, lowPower]);
  // it moves whenever the element would be playing (on screen, not held or scrubbed), muted
  useEffect(() => {
    const c = canvasRef.current;
    if (!lowPower || !shouldPlay || !url || !c || decodeFailed) return;
    const slow = window.setTimeout(() => setDecodeSlow(true), DECODED_SLOW_MS);
    const clip = startDecodedClip({
      url,
      canvas: c,
      from: decodedAt.current,
      loop: true,
      onFirstFrame: () => {
        window.clearTimeout(slow);
        setDecodeSlow(false);
        setDecodedOn(true);
        setShown(true);
      },
      onTime: (t) => {
        decodedAt.current = t;
      },
      onFail: () => {
        window.clearTimeout(slow);
        setDecodeFailed(true);
        // only now does the phone's setting keep a clip still: say why, once
        noteAutoplayRefused();
      },
    });
    clipRef.current = clip;
    return () => {
      window.clearTimeout(slow);
      clip.stop();
      decodedAt.current = clip.time();
      if (clipRef.current === clip) clipRef.current = null;
    };
  }, [lowPower, shouldPlay, url, decodeFailed]);
  // playing decoded right now (muted: its sound comes with the tap that hands it to the element)
  const decodedNow = lowPower && decodedOn && !decodeFailed;

  const soundOn = sound && !blocked && !decodedNow;
  // the phone is holding its sound back until a tap: say so, plainly (TikTok's "Tap for sound")
  const askTap = sound && !silent && controls !== "corner" && (refused ? decodedNow : blocked);
  // on a post's screen (controls up top), shown whole: between the bars
  const between = controls === "top" && fit === "contain";
  // shown whole there, a clip a little taller than the room fills its width instead of leaving black down both sides
  // (photoZoomBox at CLIP_ZOOM_MAX_TRIM, the photo's rule): the element and its poster sit in a box at its own shape
  const zoom = between && !frame ? photoZoomBox(media, focusY, CLIP_ZOOM_MAX_TRIM) : null;
  return (
    <div ref={wrap} className="absolute inset-0 bg-black" data-inline-video={playing ? "playing" : decodedNow ? "decoded" : "poster"} data-slide-path={path} data-fit={fit} data-silent={silent ? "" : undefined}>
      {frame ? (
        // framed in the studio: just that part, as its frame (its poster is that frame too)
        <ClipFrameBox
          frame={frame}
          media={media}
          fit={fit}
          area={between ? BETWEEN_BARS : undefined}
          poster={
            poster && (
              <img
                src={poster}
                alt=""
                draggable={false}
                className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200", shown ? "opacity-0" : "opacity-100")}
              />
            )
          }
        >
          {(style) => <div ref={host} style={style} data-clip-frame-host />}
        </ClipFrameBox>
      ) : zoom ? (
        <div className="absolute inset-0 overflow-hidden" style={{ ...BETWEEN_BARS, containerType: "size" }} data-clip-fit="zoom">
          <div className="absolute" style={zoom}>
            <div ref={host} className="absolute inset-0" />
            {poster && (
              <img
                src={poster}
                alt=""
                draggable={false}
                className={cn("pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200", shown ? "opacity-0" : "opacity-100")}
              />
            )}
          </div>
        </div>
      ) : (
        <>
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
                shown ? "opacity-0" : "opacity-100",
              )}
              style={between ? POSTER_BETWEEN_BARS : position && fit === "cover" ? { objectPosition: position } : undefined}
            />
          )}
        </>
      )}
      {/* loading: a quiet spinner in the middle, so a clip waiting on the network never reads as frozen */}
      {buffering && shouldPlay && !refused && (
        <div className="pointer-events-none absolute inset-0 z-[1] grid place-items-center" style={between ? BETWEEN_BARS : undefined} data-video-buffering>
          <ActivitySpinner size={28} className="text-white/85 drop-shadow" />
        </div>
      )}
      {/* its progress bar along the bottom (on a post's screen, right above the tab bar): a finger scrubs it */}
      <VideoScrubber video={el} onHold={setScrubbing} enabled={active} disabled={failed || decodedNow} />
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
      {/* the phone wouldn't start it by itself (Low Power Mode) and it can't play decoded here (or hasn't shown a frame
          yet): a play button, never a frame that just sits there; any tap starts it (video-pool.ts), this one too */}
      {refused && shouldPlay && (decodeFailed || (decodeSlow && !decodedNow)) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (el && playRefused(el)) startRefused(el);
          }}
          className="absolute inset-0 z-[2] grid place-items-center"
          style={between ? BETWEEN_BARS : undefined}
          aria-label="Play video"
          data-video-refused
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
            <Play className="ml-1 h-7 w-7 fill-current" />
          </span>
        </button>
      )}
      {/* on a post's screen the clip itself is the speaker (a tap, Instagram's): only "Tap for sound" shows there */}
      {(auto || tapped) && !failed && !silent && (controls !== "top" || askTap) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // playing decoded: this tap starts the element where it is, with its sound
            if (el && playRefused(el)) return startRefused(el);
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
            "absolute right-2.5 z-[2] flex h-8 items-center justify-center gap-1.5 rounded-full bg-black/55 text-white backdrop-blur active:scale-90",
            askTap ? "px-3 text-[13px] font-semibold" : "w-8",
            // clear of the progress bar along the bottom
            controls === "top" ? "top-[calc(var(--feed-bar-room,0px)+3rem)]" : "bottom-4",
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
