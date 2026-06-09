import { useRef } from "react";

/**
 * Double-tap (mobile) + double-click (desktop) gesture.
 * - Mobile: two touchend events <300ms apart, finger movement <12px.
 * - Desktop: dblclick with collapsed selection only (won't fire while selecting text).
 * - Ignores taps that land on links / media / form controls so links still open.
 */
const IGNORE = "a,button,textarea,input,audio,video,img,[data-no-doubletap]";

export function useDoubleTap(handler: (() => void) | null) {
  const lastRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const ignoreTarget = (el: EventTarget | null) =>
    !!(el as HTMLElement | null)?.closest?.(IGNORE);

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!handler) return;
    if (ignoreTarget(e.target)) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const now = Date.now();
    const prev = lastRef.current;
    lastRef.current = { t: now, x: t.clientX, y: t.clientY };
    if (!prev) return;
    const dt = now - prev.t;
    const dist = Math.hypot(t.clientX - prev.x, t.clientY - prev.y);
    if (dt < 320 && dist < 14) {
      lastRef.current = null;
      e.preventDefault();
      handler();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!handler) return;
    if (ignoreTarget(e.target)) return;
    try {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
    } catch {}
    handler();
  };

  return { onTouchEnd, onDoubleClick };
}