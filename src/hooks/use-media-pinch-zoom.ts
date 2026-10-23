import { useEffect } from "react";
import { useNoAutoZoom } from "@/hooks/use-no-auto-zoom";

const MAX_SCALE = 4;
/** Below this, a lifted finger lets go (two fingers that brushed it while scrolling never grab the page's finger). */
const HOLD_MIN_SCALE = 1.05;
/** How dark the page gets behind a photo at full stretch. */
const MAX_SHADE = 0.75;

/**
 * Instagram-style zoom: the page itself never zooms (pinch or double-tap),
 * but pinching a photo or video (anything marked `data-pinch-zoom`) lifts it
 * above the page and follows the fingers. Lift one finger and it stays as big
 * as it is, following the one still down; put a second back and the pinch
 * carries on from there. It springs back into place only when every finger
 * is off. Nothing else on the screen ever moves.
 *
 * One manager for the whole screen while `active` (sheets and dialogs it
 * opens included). A video that's playing is left alone (its own controls).
 * Nested users are counted (a post opened over Crew, the coach's Crew page
 * around its feed): one set of listeners, so a pinch never lifts two copies.
 */
let holders = 0;
let uninstall: (() => void) | null = null;

export function useMediaPinchZoom(active = true) {
  // Android honours the 1x cap for pinch; on iOS it stops focus-zoom on small fields.
  useNoAutoZoom(active);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (holders++ === 0) uninstall = install();
    return () => {
      if (--holders > 0) return;
      uninstall?.();
      uninstall = null;
    };
  }, [active]);
}

type Pt = { x: number; y: number };
/** Where the lifted copy is: moved by (x, y) from its place, `s` times its size, from its top-left corner. */
export type ZoomView = { x: number; y: number; s: number };

/**
 * A pinch that starts (or starts again) with `view` on screen: the spot of
 * the picture under the fingers' midpoint stays under it, and the size
 * follows how far apart they are, from the size it already has.
 */
export function pinchView(view: ZoomView, origin: Pt, d0: number, m0: Pt, d: number, m: Pt): ZoomView {
  const s = Math.min(MAX_SCALE, Math.max(1, (view.s * d) / Math.max(1, d0)));
  // the picture's own point (unscaled, from its top-left) under the first midpoint
  const lx = (m0.x - origin.x - view.x) / view.s;
  const ly = (m0.y - origin.y - view.y) / view.s;
  return { s, x: m.x - origin.x - s * lx, y: m.y - origin.y - s * ly };
}

/** One finger left: the picture keeps its size and follows it. */
export function panView(view: ZoomView, p0: Pt, p: Pt): ZoomView {
  return { s: view.s, x: view.x + p.x - p0.x, y: view.y + p.y - p0.y };
}

/** The listeners, once for the whole page; returns their removal. */
function install(): () => void {
  let zoom: {
    el: HTMLElement;
    origin: Pt;
    layer: HTMLDivElement;
    shade: HTMLDivElement;
    clone: HTMLElement;
    view: ZoomView;
    // what the fingers on it now started from (a new one each time a finger lands or lifts)
    from: { view: ZoomView; ids: number[]; d0: number; m0: Pt; p0: Pt };
  } | null = null;
  // the last one, still springing back (a new pinch takes it down at once)
  let settling: { done: () => void; timer: number } | null = null;

  const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a: Touch, b: Touch) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
  const at = (t: Touch) => ({ x: t.clientX, y: t.clientY });
  const zoomable = (t: Touch | undefined) => (t?.target instanceof Element ? t.target.closest<HTMLElement>("[data-pinch-zoom]") : null);
  const byId = (list: TouchList, id: number) => Array.from(list).find((t) => t.identifier === id);

  /** Start again from the fingers on it now and what's on screen. */
  const rebase = (touches: TouchList) => {
    if (!zoom) return;
    const [a, b] = [touches[0], touches[1]];
    zoom.from = {
      view: zoom.view,
      ids: b ? [a.identifier, b.identifier] : [a.identifier],
      d0: b ? Math.max(1, dist(a, b)) : 1,
      m0: b ? mid(a, b) : at(a),
      p0: at(a),
    };
  };

  const paint = () => {
    if (!zoom) return;
    const { x, y, s } = zoom.view;
    zoom.clone.style.transform = `translate3d(${x}px,${y}px,0) scale(${s})`;
    zoom.shade.style.opacity = String(Math.min(MAX_SHADE, (s - 1) * 0.9));
  };

  const begin = (e: TouchEvent): boolean => {
    const el = zoomable(e.touches[0]) ?? zoomable(e.touches[1]);
    if (!el) return false;
    const playing = el.querySelector("video");
    if (playing && !playing.paused) return false;
    if (settling) {
      window.clearTimeout(settling.timer);
      settling.done();
      settling = null;
    }
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.dataset.pinchLayer = "";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
    const shade = document.createElement("div");
    shade.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;";
    // what's on screen right now (the photo, or a video's still), lifted out of the page
    const clone = el.cloneNode(true) as HTMLElement;
    clone.removeAttribute("data-pinch-zoom");
    clone.style.cssText += `;position:absolute;inset:auto;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;` +
      "transform-origin:0 0;will-change:transform;overflow:hidden;";
    layer.append(shade, clone);
    document.body.append(layer);
    el.style.visibility = "hidden";
    const view = { x: 0, y: 0, s: 1 };
    zoom = { el, origin: { x: rect.left, y: rect.top }, layer, shade, clone, view, from: { view, ids: [], d0: 1, m0: { x: 0, y: 0 }, p0: { x: 0, y: 0 } } };
    rebase(e.touches);
    return true;
  };

  const finish = (animate: boolean) => {
    const z = zoom;
    zoom = null;
    if (!z) return;
    const done = () => {
      z.layer.remove();
      z.el.style.visibility = "";
    };
    if (!animate) return done();
    z.clone.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
    z.shade.style.transition = "opacity 220ms ease-out";
    z.clone.style.transform = "none";
    z.shade.style.opacity = "0";
    settling = {
      done,
      timer: window.setTimeout(() => {
        settling = null;
        done();
      }, 230),
    };
  };

  // passive: scrolling never waits on this; the moves are what get held
  const onStart = (e: TouchEvent) => {
    if (e.touches.length < 2) return;
    // a finger back down on a zoomed picture: the pinch carries on from its size now
    if (zoom) return rebase(e.touches);
    begin(e);
  };
  const onMove = (e: TouchEvent) => {
    // while a picture is up nothing under it scrolls (one finger moves the picture)
    if (zoom || e.touches.length > 1) {
      // two fingers never zoom or scroll the page
      if (e.cancelable) e.preventDefault();
    }
    if (!zoom) return;
    const { from } = zoom;
    const [a, b] = [byId(e.touches, from.ids[0]), from.ids[1] === undefined ? undefined : byId(e.touches, from.ids[1])];
    if (!a || (from.ids.length > 1 && !b)) return rebase(e.touches);
    zoom.view = b ? pinchView(from.view, zoom.origin, from.d0, from.m0, dist(a, b), mid(a, b)) : panView(from.view, from.p0, at(a));
    paint();
  };
  const onEnd = (e: TouchEvent) => {
    if (!zoom) return;
    // a finger still on it: it stays as big as it is and follows that one
    if (e.touches.length > 0 && zoom.view.s >= HOLD_MIN_SCALE) return rebase(e.touches);
    // no tap, double-tap like or link from letting go
    if (e.cancelable) e.preventDefault();
    finish(true);
  };
  // iOS: its own page pinch arrives as gesture events
  const noGesture = (e: Event) => e.preventDefault();

  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd, { passive: false });
  document.addEventListener("touchcancel", onEnd, { passive: false });
  document.addEventListener("gesturestart", noGesture, { passive: false } as AddEventListenerOptions);
  document.addEventListener("gesturechange", noGesture, { passive: false } as AddEventListenerOptions);
  document.addEventListener("gestureend", noGesture, { passive: false } as AddEventListenerOptions);
  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
    document.removeEventListener("gesturestart", noGesture);
    document.removeEventListener("gesturechange", noGesture);
    document.removeEventListener("gestureend", noGesture);
    finish(false);
    if (settling) {
      window.clearTimeout(settling.timer);
      settling.done();
      settling = null;
    }
  };
}
