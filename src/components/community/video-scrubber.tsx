import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CLIP_SCRUB_EVENT,
  KEY_STEP_SECONDS,
  LINGER_MS,
  SCRUB_TAP_PX,
  WAKE_MS,
  clipClock,
  clipClockText,
  clipLength,
  inScrubBand,
  isBarTap,
  makeScrubSeeker,
  rangesOf,
  ratioAt,
  scrubIntent,
  seekTarget,
} from "@/lib/video-scrub";

/** How long a seek's landing time is kept on the bar while the clip catches up to it. */
const LANDING_HOLD_MS = 1500;
/** The frame preview's long side, at most (Reels': about 128pt for a phone's 9:16 clip). */
const PREVIEW_LONG_PX = 128;
/** …and never more of the clip's height than this, so it fits a short card. */
const PREVIEW_MAX_SHARE = 0.42;
/** The preview and its time never come closer than this to the clip's sides. */
const FLOAT_EDGE_PX = 8;
/** Room for the time under the preview until it's measured ("0:12 / 0:45"). */
const FLOAT_MIN_W = 88;

/** At rest a line; a finger on it wakes it (thicker); scrubbing it, thicker with its time over it. */
type Mode = "rest" | "wake" | "scrub";

/**
 * A clip's progress bar, Instagram Reels' (Nov 20 2026): a thin line across
 * the bottom of the clip, nearly its full width, painted a frame at a time
 * while it plays (never through React state). It's bigger for a finger than
 * it looks: a sideways drag that starts anywhere in the clip's bottom
 * SCRUB_BAND_PX scrubs, even over the post's words (they keep their taps; the
 * drag is read from touch events on the band's root, `[data-scrub-band]`: a
 * post's screen, a full-screen clip), and a tap on the strip right at the bar
 * (SCRUB_TAP_PX, the element itself) jumps there. A finger resting on the bar
 * wakes it (thicker) within WAKE_MS; dragging, the clip holds still and
 * follows the finger (fast seeks, one in flight), the exact time is set on
 * release, and the line goes back to a line. While it's in hand a small
 * preview of the frame rides above the finger with the time under it ("0:12
 * / 0:45", plain words, no bubble, no handle), Reels': it's the clip's own
 * frame copied onto a canvas as each seek lands, never a second video, so it
 * costs no decoding and never lags the clip. Up or down from the band is the
 * feed's swipe; nothing it does reaches the post (no ❤️, sound, hold-to-pause,
 * carousel or full-screen clips). A mouse drags or clicks it at once, and the
 * keyboard's arrows move 5 s.
 *
 * The clip is the caller's `video` (the feed's pooled elements, the
 * full-screen clips' own): `onHold(true)` while a finger drags it (the caller
 * pauses it, then plays it again only if it was playing). A clip whose length
 * can't be known yet shows no bar. `enabled` false (a carousel slide that
 * isn't on screen) takes no fingers.
 */
export function VideoScrubber({
  video,
  onHold,
  onActive,
  enabled = true,
  disabled = false,
  className,
  style,
}: {
  video: HTMLVideoElement | null;
  /** True while a finger is dragging it: pause the clip until false. */
  onHold?: (held: boolean) => void;
  /** True while it's being scrubbed and for a moment after (also dispatched as CLIP_SCRUB_EVENT). */
  onActive?: (active: boolean) => void;
  enabled?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const zone = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const fill = useRef<HTMLDivElement | null>(null);
  const float = useRef<HTMLDivElement | null>(null);
  const preview = useRef<HTMLCanvasElement | null>(null);
  const clock = useRef<HTMLDivElement | null>(null);
  const now = useRef<HTMLSpanElement | null>(null);
  const total = useRef<HTMLSpanElement | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("rest");
  const cbs = useRef({ onHold, onActive });
  cbs.current = { onHold, onActive };
  const live = useRef({ enabled, disabled });
  live.current = { enabled, disabled };

  useLayoutEffect(() => {
    const v = video;
    const z = zone.current;
    if (!v || !z) {
      setLength(null);
      return;
    }
    // where a drag can start: the post's screen (its words too) or a full-screen clip; else the clip itself
    const root = (z.closest("[data-scrub-band]") as HTMLElement | null) ?? z.parentElement ?? z;
    let len: number | null = null;
    // the time the bar shows instead of the clip's own: the finger's while dragging, a seek's landing until it's there
    let pinned: number | null = null;
    let pinnedUntil = 0;
    let raf = 0;
    let lingerTimer = 0;
    let wakeTimer = 0;
    let lastSecond = -1;
    let current: Mode = "rest";
    // the frame preview: sized when a scrub starts, drawn as each seek lands (a frame at most per animation frame)
    let zoneLeft = 0;
    let zoneWidth = 0;
    let floatWidth = FLOAT_MIN_W;
    let canPreview = true;
    let drawRaf = 0;
    type Grip = {
      kind: "touch" | "pointer";
      id: number;
      x0: number;
      y0: number;
      t0: number;
      x: number;
      /** It went down on the bar's own strip (a tap there seeks), not on the words over the band. */
      onBar: boolean;
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
      if (Date.now() > pinnedUntil || (!v.seeking && Math.abs(v.currentTime - pinned) < 0.35))
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
    // the clip's own frame onto the preview (never a second decoder): a canvas that can't take it is left out
    const drawNow = () => {
      drawRaf = 0;
      const c = preview.current;
      if (!c || !canPreview || current !== "scrub" || v.readyState < 2) return;
      try {
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      } catch {
        canPreview = false;
        c.style.display = "none";
      }
    };
    const drawPreview = () => {
      if (!drawRaf) drawRaf = requestAnimationFrame(drawNow);
    };
    // the preview at the clip's own shape, its long side PREVIEW_LONG_PX (less on a short card)
    const sizePreview = () => {
      const zr = z.getBoundingClientRect();
      zoneLeft = zr.left;
      zoneWidth = zr.width;
      // as wide as the wider of the preview and its time, so either can come right up to the edge
      const clockWidth = Math.ceil(clock.current?.offsetWidth ?? 0) || FLOAT_MIN_W;
      const c = preview.current;
      if (!c || !canPreview) {
        floatWidth = clockWidth;
        if (float.current) float.current.style.width = `${floatWidth}px`;
        return;
      }
      const boxH = (z.parentElement ?? z).getBoundingClientRect().height || 400;
      const aspect = v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 9 / 16;
      const long = Math.min(PREVIEW_LONG_PX, boxH * PREVIEW_MAX_SHARE);
      let w = aspect >= 1 ? long : long * aspect;
      let h = aspect >= 1 ? long / aspect : long;
      const maxW = zoneWidth * 0.5;
      if (w > maxW) {
        const k = maxW / w;
        w *= k;
        h *= k;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
      c.style.width = `${Math.round(w)}px`;
      c.style.height = `${Math.round(h)}px`;
      floatWidth = Math.max(Math.round(w), clockWidth);
      if (float.current) float.current.style.width = `${floatWidth}px`;
    };
    // the preview and its time ride above the finger, never past the clip's sides
    const placeFloat = (x: number) => {
      const f = float.current;
      if (!f || !zoneWidth) return;
      const want = x - zoneLeft - floatWidth / 2;
      const max = Math.max(FLOAT_EDGE_PX, zoneWidth - floatWidth - FLOAT_EDGE_PX);
      const left = Math.min(max, Math.max(FLOAT_EDGE_PX, want));
      f.style.transform = `translate3d(${Math.round(left)}px,0,0)`;
    };
    const onSeeked = () => {
      settle();
      paint();
      if (grip?.scrubbing) drawPreview();
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

    // a scrub tells the post (its words and buttons step aside, like a held clip); waking only thickens the line
    const toMode = (m: Mode) => {
      if (current === m) return;
      const was = current === "scrub";
      current = m;
      setMode(m);
      if ((m === "scrub") !== was) {
        cbs.current.onActive?.(m === "scrub");
        z.dispatchEvent(
          new CustomEvent(CLIP_SCRUB_EVENT, { bubbles: true, detail: m === "scrub" }),
        );
      }
    };
    const settleDown = () => {
      window.clearTimeout(lingerTimer);
      lingerTimer = window.setTimeout(() => toMode("rest"), LINGER_MS);
    };
    // along the line as drawn (it's inset from the clip's edges); past either end is its start or its end
    const timeAt = (x: number) => {
      const r = (track.current ?? z).getBoundingClientRect();
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
      placeFloat(x);
    };
    const begin = (x: number) => {
      if (!grip || grip.scrubbing) return;
      window.clearTimeout(wakeTimer);
      window.clearTimeout(lingerTimer);
      grip.scrubbing = true;
      grip.from = v.currentTime;
      // the clip holds still while it's in hand (the caller plays it again after, if it was playing)
      cbs.current.onHold?.(true);
      sizePreview();
      toMode("scrub");
      follow(x);
      // the frame it's on now, until the first seek lands
      drawPreview();
    };
    // the finger's done: a scrub lands where it let go (or back where it was, `x` null), a wake goes back to a line
    const finish = (x: number | null) => {
      const g = grip;
      grip = null;
      window.clearTimeout(wakeTimer);
      if (!g?.scrubbing) {
        if (current === "wake") toMode("rest");
        return;
      }
      land(x == null ? g.from : timeAt(x));
      cbs.current.onHold?.(false);
      settleDown();
    };
    // a tap on the bar (or a key): the clip jumps there and keeps doing what it was doing; the line wakes a moment
    const jump = (t: number) => {
      window.clearTimeout(lingerTimer);
      toMode("wake");
      land(t);
      settleDown();
    };

    /* ---- fingers: touch events on the band's root, so a drag can start over the post's words ---- */
    const touchOf = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (grip) {
        // a second finger is a pinch, never a scrub: let go where it was
        if (grip.kind === "touch" && e.touches.length > 1) finish(grip.scrubbing ? grip.x : null);
        return;
      }
      if (e.touches.length !== 1 || !len || live.current.disabled || !live.current.enabled) return;
      const t = e.touches[0];
      if (!inScrubBand(t.clientX, t.clientY, z.getBoundingClientRect())) return;
      const onBar = z.contains(e.target as Node);
      grip = {
        kind: "touch",
        id: t.identifier,
        x0: t.clientX,
        y0: t.clientY,
        t0: Date.now(),
        x: t.clientX,
        onBar,
        scrubbing: false,
        from: v.currentTime,
      };
      // a finger resting on the bar: it has hold of it (only on the bar's own strip, never over the words)
      if (onBar)
        wakeTimer = window.setTimeout(() => {
          if (grip && !grip.scrubbing) toMode("wake");
        }, WAKE_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      const g = grip;
      if (!g || g.kind !== "touch") return;
      const t = touchOf(e.touches, g.id);
      if (!t) return;
      g.x = t.clientX;
      if (g.scrubbing) {
        // in hand, nothing scrolls under the finger (a thumb drifting up never pages the feed or swipes the carousel)
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        follow(t.clientX);
        return;
      }
      const intent = scrubIntent(t.clientX - g.x0, t.clientY - g.y0);
      if (intent === "scrub") {
        // the browser already took it (a scroll that began first): it's the feed's
        if (!e.cancelable) return finish(null);
        e.preventDefault();
        e.stopPropagation();
        begin(t.clientX);
      } else if (intent === "swipe") finish(null);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const g = grip;
      if (!g || g.kind !== "touch") return;
      const t = touchOf(e.changedTouches, g.id);
      if (!t) return;
      if (g.scrubbing) {
        // no click after a scrub
        if (e.cancelable) e.preventDefault();
        return finish(t.clientX);
      }
      grip = null;
      window.clearTimeout(wakeTimer);
      if (g.onBar && isBarTap(t.clientX - g.x0, t.clientY - g.y0, Date.now() - g.t0)) {
        // the tap is the bar's: no click on the clip under it (its sound, ❤️, full screen)
        if (e.cancelable) e.preventDefault();
        return jump(timeAt(t.clientX));
      }
      if (current === "wake") toMode("rest");
    };
    const onTouchCancel = () => {
      if (grip?.kind === "touch") finish(grip.scrubbing ? grip.x : null);
    };

    /* ---- a mouse or a pen: on the bar itself, at once ---- */
    const onDown = (e: PointerEvent) => {
      // never the post under it: no hold-to-pause, no ❤️, no carousel (a finger's own handling is the band's)
      e.stopPropagation();
      if (e.pointerType === "touch") return;
      if (!len || !e.isPrimary || live.current.disabled || e.button !== 0) return;
      e.preventDefault();
      if (grip) finish(null);
      grip = {
        kind: "pointer",
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        t0: Date.now(),
        x: e.clientX,
        onBar: true,
        scrubbing: false,
        from: v.currentTime,
      };
      try {
        z.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser already let go of */
      }
      begin(e.clientX);
    };
    const onMove = (e: PointerEvent) => {
      const g = grip;
      if (e.pointerType === "touch" || !g || g.kind !== "pointer" || e.pointerId !== g.id) return;
      e.stopPropagation();
      g.x = e.clientX;
      follow(e.clientX);
    };
    const onUp = (e: PointerEvent) => {
      const g = grip;
      if (e.pointerType === "touch" || !g || g.kind !== "pointer" || e.pointerId !== g.id) return;
      e.stopPropagation();
      finish(e.clientX);
    };
    const onLost = (e: PointerEvent) => {
      if (grip?.kind === "pointer" && e.pointerId === grip.id) finish(grip.x);
    };
    // the click a tap or a drag makes is the bar's: never a tap on the clip (sound, ❤️, full screen)
    const onClick = (e: MouseEvent) => e.stopPropagation();
    const onContext = (e: Event) => e.preventDefault();
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
      jump(to);
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
    // capture: the band sees a finger before the words or the clip under it do
    root.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    root.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    root.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    root.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true });
    z.addEventListener("pointerdown", onDown);
    z.addEventListener("pointermove", onMove);
    z.addEventListener("pointerup", onUp);
    z.addEventListener("lostpointercapture", onLost);
    z.addEventListener("click", onClick);
    z.addEventListener("contextmenu", onContext);
    z.addEventListener("keydown", onKey);
    readLength();
    paint();
    run();
    return () => {
      vidEvents.forEach(([k, f]) => v.removeEventListener(k, f));
      root.removeEventListener("touchstart", onTouchStart, true);
      root.removeEventListener("touchmove", onTouchMove, true);
      root.removeEventListener("touchend", onTouchEnd, true);
      root.removeEventListener("touchcancel", onTouchCancel, true);
      z.removeEventListener("pointerdown", onDown);
      z.removeEventListener("pointermove", onMove);
      z.removeEventListener("pointerup", onUp);
      z.removeEventListener("lostpointercapture", onLost);
      z.removeEventListener("click", onClick);
      z.removeEventListener("contextmenu", onContext);
      z.removeEventListener("keydown", onKey);
      if (raf) cancelAnimationFrame(raf);
      if (drawRaf) cancelAnimationFrame(drawRaf);
      window.clearTimeout(lingerTimer);
      window.clearTimeout(wakeTimer);
      seeker.dispose();
      // gone mid-scrub (its post scrolled away, the element went back to the pool): let go of the clip and the post
      if (grip?.scrubbing) cbs.current.onHold?.(false);
      grip = null;
      // a layout effect's cleanup: still in the page, so the post hears it
      toMode("rest");
    };
  }, [video]);

  const hidden = disabled || !length;
  const big = mode !== "rest";
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
        // the bar's own strip along the clip's bottom (a tap here seeks); a drag can start higher, in the band
        "group/scrub absolute inset-x-0 bottom-0 z-[1] cursor-pointer touch-pan-y select-none outline-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]",
        hidden && "pointer-events-none invisible",
        className,
      )}
      style={{ height: SCRUB_TAP_PX, ...style }}
      data-video-scrubber={mode === "rest" ? "" : mode}
    >
      {/* the line: nearly the clip's width, clear of the bottom edge; 2px at rest, 4px awake, 6px in hand */}
      <div
        ref={track}
        className={cn(
          "pointer-events-none absolute inset-x-3 bottom-1.5 overflow-hidden rounded-full transition-[height,background-color] duration-150 ease-out motion-reduce:transition-none",
          mode === "scrub"
            ? "h-1.5 bg-white/35"
            : mode === "wake"
              ? "h-1 bg-white/35"
              : "h-0.5 bg-white/25 [@media(hover:hover)]:group-hover/scrub:h-1",
        )}
        aria-hidden
        data-scrub-track
      >
        <div
          ref={fill}
          className={cn(
            "h-full w-full origin-left transition-colors duration-150",
            big ? "bg-white" : "bg-white/80",
          )}
          style={{ transform: "scaleX(0)" }}
        />
      </div>
      {/* scrubbing: the frame under the finger and where it is of how long, riding above the finger (no bubble) */}
      <div
        ref={float}
        className={cn(
          "pointer-events-none absolute bottom-6 left-0 flex flex-col items-center gap-2 transition-opacity duration-150 motion-reduce:transition-none",
          mode === "scrub" ? "opacity-100" : "opacity-0",
        )}
        style={{ width: FLOAT_MIN_W }}
        aria-hidden
        data-scrub-float
      >
        <canvas
          ref={preview}
          width={0}
          height={0}
          className="block rounded-xl bg-black shadow-[0_2px_12px_rgb(0_0_0/0.35)] ring-1 ring-white/20"
          data-scrub-preview
        />
        <div
          ref={clock}
          className="whitespace-nowrap text-center text-[15px] font-semibold leading-none tabular-nums text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
          data-scrub-time
        >
          <span ref={now}>0:00</span>
          <span className="text-white/70">
            {" / "}
            <span ref={total} />
          </span>
        </div>
      </div>
    </div>
  );
}
