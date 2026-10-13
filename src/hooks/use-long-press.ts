import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Hold a chat (or right-click it) to open its menu, like iMessage.
 *
 * Moving more than a few pixels is a scroll or a swipe, not a hold. The tap
 * that ends a hold doesn't also open the chat, and a hold that never produced
 * a click (iOS sometimes skips it) can't swallow the next real tap: every new
 * press starts clean.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => clear, []);

  const fire = () => {
    fired.current = true;
    clear();
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
    cb.current();
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(fire, ms);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8)) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      if (!fired.current) fire();
    },
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
