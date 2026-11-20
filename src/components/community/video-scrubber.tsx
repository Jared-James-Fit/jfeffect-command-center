import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CLIP_SCRUB_EVENT,
  GRAB_MS,
  KEY_STEP_SECONDS,
  LINGER_MS,
  clipClock,
  clipClockText,
  clipLength,
  isBarTap,
  makeScrubSeeker,
  rangesOf,
  ratioAt,
  scrubIntent,
  seekTarget,
} from "@/lib/video-scrub";

/** How long a seek's landing time is kept on the bar while the clip catches up to it. */
const LANDING_HOLD_MS = 1500;

/**
 * A clip's progress bar, Instagram Reels': a thin line along its bottom
 * while it plays, which a finger can take. Sideways from the bar scrubs (the
 * clip holds still and follows the finger, frame by frame where the phone can
 * show it; the exact time is set on release), a quick tap jumps there, a
 * finger held still grabs it; while it's in hand the line thickens, a dot
 * sits at the finger and the time shows above it ("0:12 / 0:45"). Up or down
 * from the bar is the feed's own swipe (touch-action: pan-y, the browser
 * keeps it). Nothing it does reaches the post under it: no ❤️, no sound, no
 * pause-on-hold, no carousel swipe, no full-screen clips.
 *
 * The clip is the caller's `video` (the feed's pooled elements, the
 * full-screen clips' own). `onHold(true)` while a finger drags it (the caller
 * pauses it and plays it again after, if it was playing); the progress is
 * painted straight onto the bar a frame at a time while it plays, never
 * through React state. A clip whose length can't be known shows no bar.
 */
export function VideoScrubber({
  video,
  onHold,
  onActive,
  disabled = false,
  className,
  style,
}: {
  video: HTMLVideoElement | null;
  /** True while a finger is dragging it: pause the clip until false. */
  onHold?: (held: boolean) => void;
  /** True while it's in hand and for a moment after (also dispatched as CLIP_SCRUB_EVENT). */
  onActive?: (active: boolean) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const zone = useRef<HTMLDivElement | null>(null);
  const fill = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLDivElement | null>(null);
  const now = useRef<HTMLSpanElement | null>(null);
  const total = useRef<HTMLSpanElement | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const cbs = useRef({ onHold, onActive });
  cbs.current = { onHold, onActive };
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useLayoutEffect(() => {
    const v = video;
    const z = zone.current;
    if (!v || !z) {
      setLength(null);
      return;
    }
    let len: number | null = null;
    // the time the bar shows instead of the clip's own: the finger's while dragging, a seek's landing until it's there
    let pinned: number | null = null;
    let pinnedUntil = 0;
    let raf = 0;
    let lingerTimer = 0;
    let grabTimer = 0;
    let shown = false;
    let lastSecond = -1;
    type Grip = {
      id: number;
      x0: number;
      y0: number;
      t0: number;
      x: number;
      scrubbing: boolean;
      from: number;
    };
    let grip: Grip | null = null;
    const seeker = makeScrubSeeker(v);

    const ranges = () => rangesOf(v.seekable);
    const paint = (t?: number) => {
      if (!len) return;
      const at = t ?? pinned ?? v.currentTime;
      const p = Math.min(1, Math.max(0, at / len));
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      // its dot only while it's in hand (a hidden one isn't moved a frame at a time)
      if (shown && thumb.current) thumb.current.style.left = `${p * 100}%`;
      const sec = Math.floor(at);
      if (sec !== lastSecond) {
        lastSecond = sec;
        if (now.current) now.current.textContent = clipClock(at, len);
        z.setAttribute("aria-valuenow", String(sec));
        z.setAttribute("aria-valuetext", clipClockText(at, len));
      }
    };
    const readLength = () => {
      const l = clipLength(v.duration, ranges());
      if (l === len || (l != null && len != null && Math.abs(l - len) < 0.01)) return;
      len = l;
      setLength(l);
      lastSecond = -1;
      if (total.current) total.current.textContent = l ? clipClock(l, l) : "";
      paint();
    };
    // a seek's landing time stays on the bar until the clip is there (so it never flicks back first)
    const settle = () => {
      if (pinned == null || grip?.scrubbing) return;
      if (
        Date.now() > pinnedUntil ||
        (!(v as HTMLVideoElement).seeking && Math.abs(v.currentTime - pinned) < 0.35)
      )
        pinned = null;
    };
    const frame = () => {
      settle();
      paint();
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      if (!raf && !v.paused) raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      settle();
      paint();
    };
    const onSeeked = () => {
      settle();
      paint();
    };
    const onTime = () => {
      if (v.paused) onSeeked();
    };
    const onProgress = () => {
      if (len == null) readLength();
    };
    const onEmptied = () => {
      pinned = null;
      readLength();
    };

    const show = (on: boolean) => {
      if (shown === on) return;
      shown = on;
      setActive(on);
      cbs.current.onActive?.(on);
      z.dispatchEvent(new CustomEvent(CLIP_SCRUB_EVENT, { bubbles: true, detail: on }));
    };
    const linger = () => {
      window.clearTimeout(lingerTimer);
      lingerTimer = window.setTimeout(() => show(false), LINGER_MS);
    };
    const timeAt = (x: number) => {
      const r = z.getBoundingClientRect();
      return ratioAt(x, r.left, r.width) * (len ?? 0);
    };
    // somewhere it can go, held on the bar until the clip is there
    const land = (t: number) => {
      const to = seekTarget(t, len ?? 0, ranges());
      pinned = to;
      pinnedUntil = Date.now() + LANDING_HOLD_MS;
      seeker.commit(to);
      paint(to);
    };
    const follow = (x: number) => {
      const t = seekTarget(timeAt(x), len ?? 0, ranges());
      pinned = t;
      pinnedUntil = Infinity;
      seeker.preview(t);
      paint(t);
    };
    const begin = () => {
      if (!grip || grip.scrubbing) return;
      window.clearTimeout(grabTimer);
      window.clearTimeout(lingerTimer);
      grip.scrubbing = true;
      grip.from = v.currentTime;
      // the clip holds still while it's in hand (the caller plays it again after, if it was playing)
      cbs.current.onHold?.(true);
      show(true);
      follow(grip.x);
    };
    const release = (commitAt: number | null) => {
      const g = grip;
      grip = null;
      window.clearTimeout(grabTimer);
      try {
        if (g && z.hasPointerCapture?.(g.id)) z.releasePointerCapture(g.id);
      } catch {
        /* already let go */
      }
      if (!g?.scrubbing) return;
      land(commitAt == null ? g.from : timeAt(commitAt));
      cbs.current.onHold?.(false);
      linger();
    };

    const onDown = (e: PointerEvent) => {
      if (!len || !e.isPrimary || disabledRef.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // never the post under it: no hold-to-pause, no ❤️, no carousel
      e.stopPropagation();
      if (grip) release(null);
      grip = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        t0: Date.now(),
        x: e.clientX,
        scrubbing: false,
        from: v.currentTime,
      };
      try {
        z.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser already let go of */
      }
      if (e.pointerType === "mouse") {
        // a mouse can only mean the bar: it's in hand at once
        e.preventDefault();
        begin();
        return;
      }
      // a finger held still grabs it where it is
      grabTimer = window.setTimeout(begin, GRAB_MS);
    };
    const onMove = (e: PointerEvent) => {
      const g = grip;
      if (!g || e.pointerId !== g.id) return;
      e.stopPropagation();
      g.x = e.clientX;
      if (g.scrubbing) return follow(e.clientX);
      const intent = scrubIntent(e.clientX - g.x0, e.clientY - g.y0);
      if (intent === "scrub") begin();
      // up or down first: the feed's swipe, the browser keeps it (and cancels this pointer)
      else if (intent === "swipe") {
        grip = null;
        window.clearTimeout(grabTimer);
      }
    };
    const onUp = (e: PointerEvent) => {
      const g = grip;
      if (!g || e.pointerId !== g.id) return;
      e.stopPropagation();
      if (g.scrubbing) return release(e.clientX);
      grip = null;
      window.clearTimeout(grabTimer);
      // a quick tap: the clip jumps there
      if (isBarTap(e.clientX - g.x0, e.clientY - g.y0, Date.now() - g.t0)) {
        window.clearTimeout(lingerTimer);
        show(true);
        land(timeAt(e.clientX));
        linger();
      }
    };
    // the browser took the touch (a swipe it began before we knew): wherever the finger was
    const onCancel = (e: PointerEvent) => {
      if (!grip || e.pointerId !== grip.id) return;
      release(grip.scrubbing ? grip.x : null);
    };
    // the click a tap or a drag makes is the bar's: never a tap on the clip (sound, ❤️, full screen)
    const onClick = (e: MouseEvent) => e.stopPropagation();
    // once it's in hand, nothing scrolls under the finger (a thumb drifting up never pages the feed)
    const onTouchMove = (e: TouchEvent) => {
      if (!grip?.scrubbing) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
    const onContext = (e: Event) => {
      if (grip) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!len) return;
      const at = pinned ?? v.currentTime;
      const step = e.shiftKey ? 1 : KEY_STEP_SECONDS;
      const to =
        e.key === "ArrowRight"
          ? at + step
          : e.key === "ArrowLeft"
            ? at - step
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? len
                : null;
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      window.clearTimeout(lingerTimer);
      show(true);
      land(to);
      linger();
    };

    const vidEvents: [string, () => void][] = [
      ["loadedmetadata", readLength],
      ["durationchange", readLength],
      ["emptied", onEmptied],
      ["progress", onProgress],
      ["play", run],
      ["playing", run],
      ["pause", stop],
      ["ended", stop],
      ["seeked", onSeeked],
      ["timeupdate", onTime],
    ];
    vidEvents.forEach(([k, f]) => v.addEventListener(k, f));
    z.addEventListener("pointerdown", onDown);
    z.addEventListener("pointermove", onMove);
    z.addEventListener("pointerup", onUp);
    z.addEventListener("pointercancel", onCancel);
    z.addEventListener("lostpointercapture", onCancel);
    z.addEventListener("click", onClick);
    z.addEventListener("touchmove", onTouchMove, { passive: false });
    z.addEventListener("contextmenu", onContext);
    z.addEventListener("keydown", onKey);
    readLength();
    paint();
    run();
    return () => {
      vidEvents.forEach(([k, f]) => v.removeEventListener(k, f));
      z.removeEventListener("pointerdown", onDown);
      z.removeEventListener("pointermove", onMove);
      z.removeEventListener("pointerup", onUp);
      z.removeEventListener("pointercancel", onCancel);
      z.removeEventListener("lostpointercapture", onCancel);
      z.removeEventListener("click", onClick);
      z.removeEventListener("touchmove", onTouchMove);
      z.removeEventListener("contextmenu", onContext);
      z.removeEventListener("keydown", onKey);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(lingerTimer);
      window.clearTimeout(grabTimer);
      seeker.dispose();
      // gone mid-scrub (its post scrolled away, the element went back to the pool): let go of the clip and the post
      if (grip?.scrubbing) cbs.current.onHold?.(false);
      grip = null;
      // a layout effect's cleanup: still in the page, so the post hears it
      show(false);
    };
  }, [video]);

  const hidden = disabled || !length;
  return (
    <div
      ref={zone}
      role="slider"
      tabIndex={hidden ? -1 : 0}
      aria-label="Video position"
      aria-valuemin={0}
      aria-valuemax={length ? Math.floor(length) : 0}
      aria-hidden={hidden || undefined}
      className={cn(
        // the bar's own strip along the bottom: taps and drags here are the bar's, a swipe up or down still pages the feed
        "group/scrub absolute inset-x-0 bottom-0 z-[1] h-[22px] cursor-pointer touch-pan-y select-none outline-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]",
        hidden && "pointer-events-none invisible",
        className,
      )}
      style={style}
      data-video-scrubber={active ? "active" : ""}
    >
      {/* the line: 2px flush with the bottom while it plays; in hand, 4px and lifted so its dot sits whole on it */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-1 origin-bottom overflow-hidden bg-white/25 transition-transform duration-150 ease-out motion-reduce:transition-none",
          active
            ? "-translate-y-1 scale-y-100 bg-white/35"
            : "scale-y-50 [@media(hover:hover)]:group-hover/scrub:-translate-y-1 [@media(hover:hover)]:group-hover/scrub:scale-y-100",
        )}
        aria-hidden
      >
        <div
          ref={fill}
          className={cn("h-full w-full origin-left", active ? "bg-white" : "bg-white/75")}
          style={{ transform: "scaleX(0)" }}
        />
      </div>
      <div
        ref={thumb}
        className={cn(
          "pointer-events-none absolute bottom-0 h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.15)] transition-[opacity,transform] duration-150 motion-reduce:transition-none",
          active ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
        style={{ left: "0%" }}
        aria-hidden
      />
      {/* the time, while it's in hand: where it is of how long it is */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-2.5 py-1 text-[14px] font-semibold tabular-nums leading-none text-white transition-opacity duration-150 motion-reduce:transition-none",
          active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
        data-scrub-time
      >
        <span ref={now}>0:00</span>
        <span className="text-white/60"> / </span>
        <span ref={total} className="text-white/60" />
      </div>
    </div>
  );
}
