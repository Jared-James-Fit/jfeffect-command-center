import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  IDENTITY,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  ZOOMED_MIN,
  clampView,
  dismissCloses,
  dismissIntent,
  dismissLook,
  doubleTapView,
  flipFrom,
  isDoubleTap,
  panView,
  pinchView,
  rubberView,
  wheelView,
  type Box,
  type ZoomView,
} from "@/lib/photo-zoom";

/** Where the thing tapped sits on screen: the photo grows out of it and goes back into it. */
export type FromRect = { left: number; top: number; width: number; height: number };

export type PhotoViewerProps = {
  src: string;
  alt?: string | null;
  /** Shown blurred while a big photo loads (a chat photo's thumbnail). */
  previewSrc?: string | null;
  /** "circle": a profile photo, drawn as a big circle with the name under it. */
  shape?: "circle" | "rect";
  from?: FromRect | null;
  /** Under a profile photo: whose it is. */
  caption?: string | null;
  /** In a profile photo's circle until it loads, and if it can't (their initials). */
  fallback?: string | null;
  /** A sharper copy to swap in once it's ready (a Crew photo's full-size file); the photo shown stays if there's none. */
  better?: (() => Promise<string | null>) | null;
  /** Top left, across from the close button (a chat photo's Save). */
  topLeft?: ReactNode;
  onClose: () => void;
};

const OPEN_MS = 300;
const CLOSE_MS = 240;
const SETTLE_MS = 260;
const EASE = "cubic-bezier(.2,.9,.25,1)";

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The avatar is still where it was (on screen), so the photo can go back into it. */
function onScreen(r: FromRect | null | undefined): r is FromRect {
  if (!r || r.width <= 0) return false;
  return r.top + r.height > 0 && r.left + r.width > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

const transformOf = (v: ZoomView) => (v.s === 1 && !v.x && !v.y ? "" : `translate3d(${v.x}px,${v.y}px,0) scale(${v.s})`);

/**
 * The app's one photo viewer (Nov 19 2026): a profile photo tapped anywhere
 * (UserAvatar) and a chat photo (MediaViewer) open here, full screen over a
 * dark backdrop. Instagram's / iOS Photos' gestures: pinch to zoom (lift a
 * finger and it keeps its size, following the one still down), double-tap
 * to zoom in on that spot and again to come back, one finger to move a
 * zoomed photo (its edges give a little, never a gap), and a swipe up or
 * down on an unzoomed photo, a tap off it, the ✕ or Escape to put it away.
 * A profile photo grows out of the avatar tapped and goes back into it.
 * Built on Radix's Dialog, so opened from inside a sheet it sits on top of
 * it: a tap or Escape here never closes the sheet underneath. The gesture
 * rules are photo-zoom.ts (pure, tested).
 */
export function PhotoViewer(props: PhotoViewerProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<() => void>(() => props.onClose());
  const focusRef = useRef<HTMLButtonElement | null>(null);
  // what had focus (the avatar tapped) gets it back when the photo closes
  const returnTo = useRef<HTMLElement | null>(typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && closeRef.current()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={layerRef}
          data-photo-viewer={props.shape === "circle" ? "profile" : "photo"}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            focusRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const el = returnTo.current;
            if (el && el.isConnected && el !== document.body) el.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            closeRef.current();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed inset-0 z-[2147483000] touch-none select-none overflow-hidden text-white outline-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
        >
          <DialogPrimitive.Title className="sr-only">{props.alt || props.caption || "Photo"}</DialogPrimitive.Title>
          <Stage {...props} layerRef={layerRef} closeRef={closeRef} focusRef={focusRef} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type Mode = "idle" | "maybe" | "pan" | "pinch" | "dismiss" | "none";

function Stage({
  src: initialSrc,
  alt,
  previewSrc,
  shape = "rect",
  from,
  caption,
  fallback,
  better,
  topLeft,
  onClose,
  layerRef,
  closeRef,
  focusRef,
}: PhotoViewerProps & {
  layerRef: MutableRefObject<HTMLDivElement | null>;
  closeRef: MutableRefObject<() => void>;
  focusRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const circle = shape === "circle";
  const maxShade = circle ? 0.94 : 1;
  const [src, setSrc] = useState(initialSrc);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [retry, setRetry] = useState(0);
  const shadeRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const photoRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  /** Where the photo rests now (zoomed or not); a gesture paints over it until it settles. */
  const view = useRef<ZoomView>(IDENTITY);
  const leaving = useRef(false);

  /** The photo's place, unzoomed and unmoved (its frame never has a gesture's transform, and offsets ignore the morph). */
  const box = (): Box => {
    const f = frameRef.current;
    return f ? { left: f.offsetLeft, top: f.offsetTop, w: f.offsetWidth, h: f.offsetHeight } : { left: 0, top: 0, w: 0, h: 0 };
  };
  const viewport = () => {
    const l = layerRef.current;
    return { w: l?.clientWidth || window.innerWidth, h: l?.clientHeight || window.innerHeight };
  };
  const paint = (v: ZoomView, ms = 0) => {
    const el = photoRef.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
    el.style.transform = transformOf(v);
  };
  /** The backdrop and everything around the photo, from 0 (the page shows through) to 1. */
  const shade = (o: number, ms = 0) => {
    const set = (el: HTMLElement | null, value: number) => {
      if (!el) return;
      el.style.transition = ms ? `opacity ${ms}ms ease-out` : "none";
      el.style.opacity = String(value);
    };
    set(shadeRef.current, o * maxShade);
    // the name and the ✕ go first as the photo is pulled away
    const words = Math.max(0, 1 - 2.5 * (1 - o));
    set(captionRef.current, words);
    set(controlsRef.current, words);
  };

  // A sharper copy, once it has loaded (never a blank moment while it does).
  useEffect(() => {
    if (!better) return;
    let off = false;
    better().then(
      (url) => {
        if (!url || off || url === initialSrc) return;
        const im = new Image();
        im.src = url;
        const ready = typeof im.decode === "function" ? im.decode() : new Promise<void>((res, rej) => ((im.onload = () => res()), (im.onerror = rej)));
        ready.then(
          () => {
            if (off) return;
            setSrc(url);
            setErrored(false);
          },
          () => {},
        );
      },
      () => {},
    );
    return () => {
      off = true;
    };
  }, [better, initialSrc]);

  const close = () => {
    if (leaving.current) return;
    leaving.current = true;
    const frame = frameRef.current;
    const layer = layerRef.current;
    const reduce = reducedMotion();
    const morph = circle && !reduce && onScreen(from) && frame && box().w > 0;
    if (morph) {
      // back into the avatar it came from, a zoomed or pulled photo coming back as it shrinks
      const f = flipFrom(from!, box());
      frame.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(.3,0,.2,1)`;
      frame.style.transform = `translate3d(${f.x}px,${f.y}px,0) scale(${f.s})`;
      paint(IDENTITY, CLOSE_MS);
      shade(0, CLOSE_MS - 40);
    } else if (layer) {
      layer.style.transition = `opacity ${reduce ? 120 : 160}ms ease-out`;
      layer.style.opacity = "0";
    }
    window.setTimeout(onClose, morph ? CLOSE_MS : reduce ? 120 : 160);
  };
  closeRef.current = close;

  // Opening: a profile photo grows out of the avatar tapped; anything else fades in.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    // (the dialog's own ref is set after this runs: children's layout effects come first)
    const layer = frame?.closest<HTMLElement>("[data-photo-viewer]");
    if (!frame || !layer) return;
    const reduce = reducedMotion();
    if (circle && !reduce && onScreen(from) && box().w > 0) {
      const f = flipFrom(from, box());
      frame.style.transition = "none";
      frame.style.transform = `translate3d(${f.x}px,${f.y}px,0) scale(${f.s})`;
      shade(0);
      void frame.offsetWidth;
      const raf = requestAnimationFrame(() => {
        frame.style.transition = `transform ${OPEN_MS}ms ${EASE}`;
        frame.style.transform = "";
        shade(1, 220);
      });
      return () => cancelAnimationFrame(raf);
    }
    layer.style.opacity = "0";
    if (!reduce) frame.style.transform = "scale(0.96)";
    void layer.offsetWidth;
    const raf = requestAnimationFrame(() => {
      layer.style.transition = `opacity ${reduce ? 120 : 180}ms ease-out`;
      layer.style.opacity = "1";
      frame.style.transition = `transform 220ms ${EASE}`;
      frame.style.transform = "";
    });
    return () => cancelAnimationFrame(raf);
    // once, as it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The gestures: one set of pointer listeners on the whole screen (touch, pen and mouse alike).
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: Mode = "idle";
    let live: ZoomView = IDENTITY;
    let start = { x: 0, y: 0, t: 0 };
    let downOnPhoto = false;
    let base = { view: IDENTITY, d0: 1, m0: { x: 0, y: 0 }, p0: { x: 0, y: 0 } };
    let pull = { dx: 0, dy: 0 };
    let lastTap: { t: number; x: number; y: number } | null = null;
    let b = box();
    let vp = viewport();

    const pts = () => Array.from(pointers.values());
    const dist = (a: { x: number; y: number }, c: { x: number; y: number }) => Math.hypot(a.x - c.x, a.y - c.y);
    const mid = (a: { x: number; y: number }, c: { x: number; y: number }) => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
    const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-viewer-control]");
    /** Whether a point is on the photo as it's drawn now (a profile photo is a circle). */
    const onPhoto = (p: { x: number; y: number }) => {
      const v = view.current;
      const w = b.w * v.s;
      const h = b.h * v.s;
      const left = b.left + v.x;
      const top = b.top + v.y;
      if (!w || !h) return false;
      if (circle) return Math.hypot(p.x - (left + w / 2), p.y - (top + h / 2)) <= w / 2;
      return p.x >= left && p.x <= left + w && p.y >= top && p.y <= top + h;
    };
    const settle = (v: ZoomView) => {
      const c = clampView(v, b, vp);
      view.current = c;
      live = c;
      paint(c, SETTLE_MS);
    };
    const springBack = () => {
      live = view.current;
      paint(live, SETTLE_MS);
      shade(1, 200);
    };

    const down = (e: PointerEvent) => {
      if (leaving.current || isControl(e.target)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        layer.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that's already gone */
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      b = box();
      vp = viewport();
      if (pointers.size === 1) {
        mode = "maybe";
        start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        downOnPhoto = onPhoto(start);
        live = view.current;
        return;
      }
      if (pointers.size === 2 && b.w > 0) {
        // a second finger: a pull away stops, and the pinch starts from what's on screen
        if (mode === "dismiss") {
          pull = { dx: 0, dy: 0 };
          live = view.current;
          paint(live);
          shade(1);
        }
        const [a, c] = pts();
        base = { view: live, d0: Math.max(1, dist(a!, c!)), m0: mid(a!, c!), p0: a! };
        mode = "pinch";
      }
    };

    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || leaving.current) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = { x: e.clientX, y: e.clientY };
      if (mode === "pinch") {
        const [a, c] = pts();
        if (!a || !c) return;
        live = pinchView(base.view, { x: b.left, y: b.top }, base.d0, base.m0, dist(a, c), mid(a, c));
        paint(live);
        return;
      }
      if (mode === "maybe") {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (view.current.s >= ZOOMED_MIN) {
          if (Math.hypot(dx, dy) < TAP_SLOP_PX) return;
          mode = "pan";
          base = { ...base, view: view.current, p0: start };
        } else {
          const intent = dismissIntent(dx, dy);
          if (intent === "wait") return;
          mode = intent === "drag" ? "dismiss" : "none";
        }
      }
      if (mode === "pan") {
        live = rubberView(panView(base.view, base.p0, p), b, vp);
        paint(live);
        return;
      }
      if (mode === "dismiss") {
        pull = { dx: p.x - start.x, dy: p.y - start.y };
        const look = dismissLook(pull.dy, vp.h);
        const w = b.w || vp.w * 0.6;
        const h = b.h || vp.h * 0.4;
        live = { s: look.scale, x: pull.dx + (w * (1 - look.scale)) / 2, y: pull.dy + (h * (1 - look.scale)) / 2 };
        paint(live);
        shade(look.shade);
      }
    };

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (leaving.current) return;
      const cancelled = e.type === "pointercancel";
      if (mode === "pinch") {
        if (pointers.size === 1) {
          // one finger stays: the photo keeps its size and follows it
          const [rest] = pts();
          if (live.s >= ZOOMED_MIN) {
            view.current = live;
            mode = "pan";
            base = { ...base, view: live, p0: rest! };
          } else mode = "none";
          return;
        }
        if (pointers.size === 0) {
          mode = "idle";
          settle(live);
        }
        return;
      }
      if (pointers.size > 0) return;
      const was = mode;
      mode = "idle";
      if (was === "pan" || was === "none") return settle(live);
      if (was === "dismiss") {
        if (!cancelled && dismissCloses(pull.dy, e.timeStamp - start.t, b.h || vp.h * 0.4)) return closeRef.current();
        return springBack();
      }
      if (was !== "maybe" || cancelled) return;
      const tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      if (Math.hypot(tap.x - start.x, tap.y - start.y) > TAP_SLOP_PX || tap.t - start.t > TAP_MAX_MS) return;
      if (downOnPhoto && b.w > 0 && isDoubleTap(lastTap, tap)) {
        lastTap = null;
        const v = doubleTapView(view.current, b, vp, tap);
        view.current = v;
        live = v;
        paint(v, 280);
        return;
      }
      lastTap = downOnPhoto ? tap : null;
      // a tap off the photo puts it away
      if (!downOnPhoto) closeRef.current();
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (leaving.current) return;
      b = box();
      vp = viewport();
      if (!b.w) return;
      const v = wheelView(view.current, b, vp, { x: e.clientX, y: e.clientY }, e.deltaY, e.ctrlKey);
      view.current = v;
      live = v;
      paint(v);
    };
    // iOS: its own page pinch arrives as gesture events
    const noGesture = (e: Event) => e.preventDefault();
    // a turned phone or a resized window: the photo goes back to its place
    const resized = () => {
      if (view.current.s === 1) return;
      view.current = IDENTITY;
      live = IDENTITY;
      paint(IDENTITY);
    };

    layer.addEventListener("pointerdown", down);
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
    layer.addEventListener("wheel", wheel, { passive: false });
    layer.addEventListener("gesturestart", noGesture, { passive: false } as AddEventListenerOptions);
    layer.addEventListener("gesturechange", noGesture, { passive: false } as AddEventListenerOptions);
    window.addEventListener("resize", resized);
    return () => {
      layer.removeEventListener("pointerdown", down);
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      layer.removeEventListener("wheel", wheel);
      layer.removeEventListener("gesturestart", noGesture);
      layer.removeEventListener("gesturechange", noGesture);
      window.removeEventListener("resize", resized);
    };
    // the listeners read everything through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circle]);

  const shownSrc = retry > 0 ? `${src}${src.includes("?") ? "&" : "?"}_r=${retry}` : src;
  const tryAgain = () => {
    setErrored(false);
    setLoaded(false);
    setRetry((r) => r + 1);
  };

  return (
    <>
      <div
        ref={shadeRef}
        aria-hidden
        data-photo-shade
        className="absolute inset-0 bg-black"
        // a profile photo's page behind is blurred out, never read through the dark
        style={{ opacity: maxShade, ...(circle ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } : null) }}
      />

      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={
          circle
            ? { padding: "calc(env(safe-area-inset-top) + 64px) 24px calc(env(safe-area-inset-bottom) + 64px)" }
            : { padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)" }
        }
      >
        {!circle && !loaded && !errored && previewSrc && (
          <img src={previewSrc} alt="" aria-hidden draggable={false} className="pointer-events-none absolute max-h-full max-w-full object-contain opacity-70 blur-md" />
        )}

        <div
          ref={frameRef}
          data-photo-frame
          className={cn("relative z-[1] will-change-transform", circle && "aspect-square w-[min(calc(100vw-48px),54vh,420px)] shrink-0")}
        >
          <div
            ref={photoRef}
            data-photo
            className={cn("relative origin-top-left will-change-transform", circle && "h-full w-full overflow-hidden rounded-full bg-neutral-800")}
          >
            {circle && (!loaded || errored) && (
              <div aria-hidden className="absolute inset-0 grid place-items-center font-semibold text-white/70" style={{ fontSize: "clamp(48px, 16vw, 128px)" }}>
                {fallback || "?"}
              </div>
            )}
            {errored ? (
              circle ? null : (
                <div className="flex flex-col items-center gap-3 px-6 py-10 text-white/85">
                  <div className="text-sm">Image couldn't load</div>
                  <button
                    type="button"
                    data-viewer-control
                    onClick={tryAgain}
                    className="min-h-10 rounded-lg border border-white/40 px-4 text-sm font-semibold hover:bg-white/10"
                  >
                    Try again
                  </button>
                </div>
              )
            ) : (
              <img
                src={shownSrc}
                alt={alt ?? ""}
                draggable={false}
                decoding="async"
                onLoad={() => setLoaded(true)}
                onError={() => setErrored(true)}
                className={cn(
                  "block select-none transition-opacity duration-200",
                  circle ? "absolute inset-0 h-full w-full object-cover" : "object-contain",
                  loaded ? "opacity-100" : "opacity-0",
                )}
                style={
                  circle
                    ? undefined
                    : {
                        maxWidth: "calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right))",
                        maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
                        imageOrientation: "from-image",
                      }
                }
              />
            )}
          </div>
        </div>

        {circle && (caption || errored) && (
          <div ref={captionRef} className="mt-5 flex max-w-full flex-col items-center gap-1 px-4 text-center">
            {caption && <div className="max-w-[80vw] truncate text-[17px] font-semibold text-white/95">{caption}</div>}
            {errored && (
              <button type="button" data-viewer-control onClick={tryAgain} className="min-h-10 px-3 text-[14px] text-white/65 underline-offset-2 hover:underline">
                Couldn't load the photo · Try again
              </button>
            )}
          </div>
        )}

        {!circle && !loaded && !errored && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/85">Loading image…</div>
        )}
      </div>

      <div ref={controlsRef} className="pointer-events-none absolute inset-0">
        {topLeft && (
          <div data-viewer-control className="pointer-events-auto">
            {topLeft}
          </div>
        )}
        <button
          ref={focusRef}
          type="button"
          data-viewer-control
          aria-label="Close"
          onClick={() => closeRef.current()}
          className="pointer-events-auto absolute grid h-11 w-11 place-items-center rounded-full text-white/80 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 active:bg-white/15"
          style={{
            top: "calc(env(safe-area-inset-top) + var(--ios-edge-room, 0px) + 6px)",
            right: "calc(env(safe-area-inset-right) + 6px)",
          }}
        >
          <X className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>
    </>
  );
}
