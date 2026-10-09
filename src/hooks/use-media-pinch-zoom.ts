import { useEffect } from "react";
import { useNoAutoZoom } from "@/hooks/use-no-auto-zoom";

const MAX_SCALE = 4;
/** How dark the page gets behind a photo at full stretch. */
const MAX_SHADE = 0.75;

/**
 * Instagram-style zoom: the page itself never zooms (pinch or double-tap),
 * but pinching a photo or video (anything marked `data-pinch-zoom`) lifts it
 * above the page, follows both fingers (size and position) and springs back
 * into place on release. Nothing else on the screen ever moves.
 *
 * One manager for the whole screen while `active` (sheets and dialogs it
 * opens included). A video that's playing is left alone (its own controls).
 */
export function useMediaPinchZoom(active = true) {
  // Android honours the 1x cap for pinch; on iOS it stops focus-zoom on small fields.
  useNoAutoZoom(active);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    let zoom: {
      el: HTMLElement;
      d0: number;
      mx: number;
      my: number;
      layer: HTMLDivElement;
      shade: HTMLDivElement;
      clone: HTMLElement;
    } | null = null;

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const zoomable = (t: Touch | undefined) => (t?.target instanceof Element ? t.target.closest<HTMLElement>("[data-pinch-zoom]") : null);

    const begin = (e: TouchEvent): boolean => {
      const el = zoomable(e.touches[0]) ?? zoomable(e.touches[1]);
      if (!el) return false;
      const playing = el.querySelector("video");
      if (playing && !playing.paused) return false;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const m = mid(e.touches);
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
        `transform-origin:${m.x - rect.left}px ${m.y - rect.top}px;will-change:transform;overflow:hidden;`;
      layer.append(shade, clone);
      document.body.append(layer);
      el.style.visibility = "hidden";
      zoom = { el, d0: Math.max(1, dist(e.touches)), mx: m.x, my: m.y, layer, shade, clone };
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
      window.setTimeout(done, 230);
    };

    // passive: scrolling never waits on this; the moves are what get held
    const onStart = (e: TouchEvent) => {
      if (zoom || e.touches.length !== 2) return;
      begin(e);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      // two fingers never zoom or scroll the page
      if (e.cancelable) e.preventDefault();
      if (!zoom) return;
      const s = Math.min(MAX_SCALE, Math.max(1, dist(e.touches) / zoom.d0));
      const m = mid(e.touches);
      zoom.clone.style.transform = `translate3d(${m.x - zoom.mx}px,${m.y - zoom.my}px,0) scale(${s})`;
      zoom.shade.style.opacity = String(Math.min(MAX_SHADE, (s - 1) * 0.9));
    };
    const onEnd = (e: TouchEvent) => {
      if (zoom && e.touches.length < 2) finish(true);
    };
    // iOS: its own page pinch arrives as gesture events
    const noGesture = (e: Event) => e.preventDefault();

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
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
    };
  }, [active]);
}
