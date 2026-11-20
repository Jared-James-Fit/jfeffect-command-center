import { useEffect, useRef } from "react";
import { sheetDragCloses, sheetDragIntent } from "@/lib/post-sheet";

/** Where a drag never starts: typing, a slider, or anything that opts out. */
const NO_DRAG = "input, textarea, select, [contenteditable='true'], [role='slider'], [data-no-sheet-drag]";

/** Whether anything between the finger and the sheet (the sheet included) is scrolled down: then a pull down scrolls it back up. */
function scrolledDown(target: Element | null, sheet: HTMLElement): boolean {
  for (let n: Element | null = target; n; n = n.parentElement) {
    if (n.scrollTop > 0) return true;
    if (n === sheet) break;
  }
  return false;
}

/**
 * One swipe down closes a bottom sheet (Instagram's, TikTok's): a finger that
 * goes down on the sheet and moves mostly downward (sheetDragIntent) drags it
 * with the finger, and letting go far enough down or with a flick
 * (sheetDragCloses) closes it from where it is, else it springs back. A swipe
 * up or sideways is the sheet's own (its list, tabs, a carousel), and so is a
 * pull down that starts in a list scrolled down (it scrolls back up first),
 * on a text box or a slider, or inside [data-no-sheet-drag].
 */
export function useSwipeDownToClose(el: HTMLElement | null, active: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || !el) return;
    // a sheet opened again on the same element starts where it belongs
    el.style.transform = "";
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let mode: "idle" | "maybe" | "drag" = "idle";
    // the rest of a touch is sent to the element it started on, even once that element has left the page
    // (a list that loads while the finger is down), where it never reaches the sheet: it's followed there
    let target: EventTarget | null = null;
    const follow = (t: EventTarget | null) => {
      unfollow();
      target = t;
      target?.addEventListener("touchmove", onMove as EventListener, { passive: false });
      target?.addEventListener("touchend", onEnd as EventListener);
      target?.addEventListener("touchcancel", onCancel);
    };
    const unfollow = () => {
      target?.removeEventListener("touchmove", onMove as EventListener);
      target?.removeEventListener("touchend", onEnd as EventListener);
      target?.removeEventListener("touchcancel", onCancel);
      target = null;
    };
    const settle = () => {
      el.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      el.style.transform = "";
    };
    const onStart = (e: TouchEvent) => {
      mode = "idle";
      unfollow();
      if (e.touches.length !== 1) return;
      const t = e.target as Element | null;
      if (t?.closest?.(NO_DRAG) || scrolledDown(t, el)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = e.timeStamp;
      dy = 0;
      mode = "maybe";
      follow(e.target);
    };
    const onMove = (e: TouchEvent) => {
      if (mode === "idle") return;
      const d = e.touches[0].clientY - startY;
      if (mode === "maybe") {
        const intent = sheetDragIntent(e.touches[0].clientX - startX, d);
        if (intent === "wait") return;
        if (intent === "pass") {
          mode = "idle";
          unfollow();
          return;
        }
        mode = "drag";
        el.style.transition = "none";
      }
      e.preventDefault();
      dy = Math.max(0, d);
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
    };
    const onEnd = (e: TouchEvent) => {
      unfollow();
      if (mode !== "drag") {
        mode = "idle";
        return;
      }
      mode = "idle";
      // closing slides it out from where the finger left it (the exit animation starts there)
      if (sheetDragCloses({ dy, ms: e.timeStamp - startT, height: el.offsetHeight })) closeRef.current();
      else settle();
    };
    const onCancel = () => {
      unfollow();
      if (mode === "drag") settle();
      mode = "idle";
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      unfollow();
      // the transform stays: a sheet closed by a swipe slides out from where the finger left it
    };
  }, [el, active]);
}
