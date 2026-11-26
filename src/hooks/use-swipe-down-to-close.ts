import { useEffect, useRef } from "react";
import { sheetDragCloses, sheetDragGrows, sheetDragMode, sheetFullRelease } from "@/lib/post-sheet";
import { claimGesture, heldByOther, onGestureReset, releaseGesture, targetOwns } from "@/lib/gesture-arena";

/** Who holds the finger while a sheet follows it (the gesture arena). */
const ARENA_ID = "sheet-drag";

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

/** How the sheet eases to where it's going (a spring-ish curve, Instagram's). */
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const SHEET_SETTLE = `transform 220ms ${EASE}, height 240ms ${EASE}`;

/**
 * A sheet that also opens up (the post's sheet, Nov 21 2026): from half, a
 * drag up grows it with the finger (before anything inside scrolls) and lets
 * go at full or back at half; from full, a drag down goes back to half or
 * closes it. `enabled` off while typing (the keyboard sizes it then).
 */
export type SheetExpand = {
  full: boolean;
  enabled: boolean;
  /** Its heights as CSS (what its style says at half and at full). */
  halfCss: string;
  fullCss: string;
  onChange: (full: boolean) => void;
};

/**
 * One swipe down closes a bottom sheet (Instagram's, TikTok's): a finger that
 * goes down on the sheet and moves mostly downward (sheetDragIntent) drags it
 * with the finger, and letting go far enough down or with a flick
 * (sheetDragCloses) closes it from where it is, else it springs back. A swipe
 * up or sideways is the sheet's own (its list, tabs, a carousel), and so is a
 * pull down that starts in a list scrolled down (it scrolls back up first),
 * on a text box or a slider, inside [data-no-sheet-drag], or on anything that owns up-and-down
 * drags itself (the gesture arena: `touch-action: none`, a map, a drawing pad), which keeps the
 * finger; while something else holds the finger (the arena) the sheet never moves.
 */
export function useSwipeDownToClose(el: HTMLElement | null, active: boolean, close: () => void, expand?: SheetExpand | null): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const expandRef = useRef(expand ?? null);
  expandRef.current = expand ?? null;
  useEffect(() => {
    if (!active || !el) return;
    // a sheet opened again on the same element starts where it belongs
    el.style.transform = "";
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let mode: "idle" | "maybe" | "drag" | "grow" = "idle";
    // the list inside was scrolled down when the finger landed: a pull down scrolls it back first
    let scrolled = false;
    // growing: its height when the finger landed, and at full
    let startH = 0;
    let fullH = 0;
    let grownH = 0;
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
      el.style.transition = SHEET_SETTLE;
      el.style.transform = "";
    };
    // eases to half or full; its style (React's) says the same height, so nothing fights it
    const setFull = (full: boolean) => {
      const ex = expandRef.current;
      if (!ex) return settle();
      el.style.transition = SHEET_SETTLE;
      el.style.transform = "";
      el.style.height = full ? ex.fullCss : ex.halfCss;
      if (full !== ex.full) ex.onChange(full);
    };
    const measureFull = (css: string) => {
      const was = el.style.height;
      el.style.height = css;
      const h = el.offsetHeight;
      el.style.height = was;
      return h;
    };
    const onStart = (e: TouchEvent) => {
      mode = "idle";
      unfollow();
      if (e.touches.length !== 1) return;
      const t = e.target as Element | null;
      if (t?.closest?.(NO_DRAG) || targetOwns(t, "y", el)) return;
      scrolled = scrolledDown(t, el);
      const ex = expandRef.current;
      // scrolled down with nowhere to grow: the touch is the list's (it scrolls back up first)
      if (scrolled && !(ex?.enabled && !ex.full)) return;
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
        // something under the finger took it (a drag in the sheet): never the sheet's
        if (heldByOther(ARENA_ID)) {
          mode = "idle";
          unfollow();
          return;
        }
        const ex = expandRef.current;
        const intent = sheetDragMode(e.touches[0].clientX - startX, d, { canGrow: !!ex?.enabled && !ex.full });
        if (intent === "wait") return;
        if (intent === "pass" || (intent === "drag" && scrolled)) {
          mode = "idle";
          unfollow();
          return;
        }
        if (!claimGesture(ARENA_ID)) {
          mode = "idle";
          unfollow();
          return;
        }
        el.style.transition = "none";
        if (intent === "grow" && ex) {
          mode = "grow";
          startH = el.offsetHeight;
          fullH = Math.max(startH, measureFull(ex.fullCss));
          grownH = startH;
        } else mode = "drag";
      }
      e.preventDefault();
      if (mode === "grow") {
        // the sheet grows with the finger up to full; nothing inside scrolls meanwhile
        grownH = Math.min(fullH, startH + Math.max(0, -d));
        el.style.height = `${grownH}px`;
        return;
      }
      dy = Math.max(0, d);
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
    };
    const onEnd = (e: TouchEvent) => {
      unfollow();
      releaseGesture(ARENA_ID);
      const was = mode;
      mode = "idle";
      const ms = e.timeStamp - startT;
      if (was === "grow") return setFull(sheetDragGrows({ up: grownH - startH, ms }));
      if (was !== "drag") return;
      const ex = expandRef.current;
      const height = el.offsetHeight;
      if (ex?.enabled && ex.full) {
        // from full: back to half, or closed with a real pull
        const where = sheetFullRelease({ dy, ms, height });
        if (where === "close") closeRef.current();
        else setFull(where === "full");
        return;
      }
      // closing slides it out from where the finger left it (the exit animation starts there)
      if (sheetDragCloses({ dy, ms, height })) closeRef.current();
      else settle();
    };
    const onCancel = () => {
      unfollow();
      releaseGesture(ARENA_ID);
      if (mode === "drag") settle();
      if (mode === "grow") setFull(false);
      mode = "idle";
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    // the app went away mid-drag: the sheet goes back to where it belongs
    const stopReset = onGestureReset(() => {
      if (mode !== "idle") onCancel();
    });
    return () => {
      el.removeEventListener("touchstart", onStart);
      stopReset();
      releaseGesture(ARENA_ID);
      unfollow();
      // the transform stays: a sheet closed by a swipe slides out from where the finger left it
    };
  }, [el, active]);
}
