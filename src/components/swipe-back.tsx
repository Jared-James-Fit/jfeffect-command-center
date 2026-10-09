import { useEffect, useRef, type RefObject } from "react";
import { ChevronLeft, X } from "lucide-react";

/** The phone's own edge swipe lives here: leave it to the phone. */
const EDGE_PX = 24;
/** How far a finger moves before we decide it's a sideways swipe. */
const LOCK_PX = 10;
/** Past this share of the screen, letting go goes back. */
const COMMIT = 0.28;
/** Or a quick flick (px per ms), once it's moved a little. */
const FLICK = 0.45;

/**
 * Swipe right from anywhere on the screen to go back (not just the very
 * edge). The page follows your finger, an arrow fills in, and letting go
 * past about a quarter of the screen (or a quick flick) goes back.
 *
 * Stays out of the way of everything else: vertical scrolling, open sheets
 * and dialogs, text fields, anything marked `data-no-swipe-back`, and a
 * sideways scroller that can still scroll back (a carousel past its first
 * photo swipes the carousel; on its first photo, it's a back swipe).
 */
export function SwipeBack({
  enabled,
  target,
  onBack,
  onUsed,
}: {
  enabled: boolean;
  /** What slides with the finger. */
  target: RefObject<HTMLElement | null>;
  onBack: () => void;
  /** Someone used it (for retiring the demo). */
  onUsed?: () => void;
}) {
  const arrow = useRef<HTMLDivElement | null>(null);
  const cb = useRef({ onBack, onUsed });
  cb.current = { onBack, onUsed };

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let start: { x: number; y: number } | null = null;
    let mode: "undecided" | "back" | "off" = "off";
    let dx = 0;
    let lastX = 0;
    let lastT = 0;
    let speed = 0;
    let armed = false;
    let leaving = false;

    const blocked = (el: EventTarget | null) => {
      if (!(el instanceof Element)) return true;
      if (el.closest('[role="dialog"],[role="alertdialog"],[data-no-swipe-back],input,textarea,select,[contenteditable="true"]')) return true;
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollLeft > 0 && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const sheetOpen = () => !!document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]');

    const paint = (x: number, y: number | null, animate: boolean) => {
      const el = target.current;
      const a = arrow.current;
      const w = window.innerWidth || 1;
      if (el) {
        el.style.transition = animate ? "transform 180ms cubic-bezier(.2,.8,.2,1)" : "none";
        el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
        el.style.boxShadow = x ? "-12px 0 28px rgba(0,0,0,.18)" : "";
        el.style.willChange = x ? "transform" : "";
      }
      if (a) {
        const p = Math.min(1, x / (w * COMMIT));
        a.style.transition = animate ? "opacity 180ms, transform 180ms" : "none";
        a.style.opacity = String(p);
        if (y != null) a.style.top = `${Math.max(80, Math.min(window.innerHeight - 140, y - 22))}px`;
        a.style.transform = `translateX(${Math.min(x * 0.35, 28)}px) scale(${0.6 + 0.4 * p})`;
        a.dataset.armed = p >= 1 ? "1" : "0";
      }
    };
    const reset = () => {
      const el = target.current;
      if (el) {
        el.style.transition = "";
        el.style.transform = "";
        el.style.boxShadow = "";
        el.style.willChange = "";
      }
      if (arrow.current) arrow.current.style.opacity = "0";
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      mode = "off";
      if (leaving || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < EDGE_PX || sheetOpen() || blocked(e.target)) return;
      start = { x: t.clientX, y: t.clientY };
      mode = "undecided";
      dx = 0;
      speed = 0;
      armed = false;
      lastX = t.clientX;
      lastT = e.timeStamp;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || mode === "off") return;
      if (e.touches.length !== 1) {
        mode = "off";
        paint(0, null, true);
        return;
      }
      const t = e.touches[0];
      const ddx = t.clientX - start.x;
      const ddy = t.clientY - start.y;
      if (mode === "undecided") {
        if (Math.abs(ddx) < LOCK_PX && Math.abs(ddy) < LOCK_PX) return;
        if (ddx > 0 && ddx > Math.abs(ddy) * 1.3) mode = "back";
        else {
          mode = "off";
          return;
        }
      }
      // ours now: no scrolling underneath
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, ddx);
      const dt = e.timeStamp - lastT;
      if (dt > 0) speed = (t.clientX - lastX) / dt;
      lastX = t.clientX;
      lastT = e.timeStamp;
      const over = dx > window.innerWidth * COMMIT;
      if (over !== armed) {
        armed = over;
        if (over) {
          try {
            navigator.vibrate?.(8);
          } catch {
            /* no haptics */
          }
        }
      }
      paint(dx, t.clientY, false);
    };
    const onEnd = () => {
      if (!start || mode !== "back") {
        start = null;
        mode = "off";
        return;
      }
      const go = dx > window.innerWidth * COMMIT || (speed > FLICK && dx > 40);
      start = null;
      mode = "off";
      if (!go) {
        paint(0, null, true);
        return;
      }
      leaving = true;
      paint(window.innerWidth, null, true);
      window.setTimeout(() => {
        leaving = false;
        cb.current.onUsed?.();
        cb.current.onBack();
        // still here (went back within the page)? settle it
        requestAnimationFrame(reset);
      }, 170);
    };
    const onCancel = () => {
      if (mode === "back") paint(0, null, true);
      start = null;
      mode = "off";
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      reset();
    };
  }, [enabled, target]);

  if (!enabled) return null;
  return (
    <div
      ref={arrow}
      aria-hidden
      className="pointer-events-none fixed left-2 z-[60] grid h-11 w-11 place-items-center rounded-full bg-foreground text-background opacity-0 shadow-lg data-[armed=1]:bg-primary data-[armed=1]:text-primary-foreground"
      style={{ top: "45%" }}
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
    </div>
  );
}

/**
 * The on-screen ask: a finger sweeping right with the back arrow, "Swipe
 * right anywhere to go back". Shows until it's been used once (the caller
 * decides); × hides it for now.
 */
export function SwipeBackTip({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 flex justify-center px-4 animate-in fade-in slide-in-from-bottom-2" role="status">
      <div className="pointer-events-auto flex w-full max-w-[360px] items-center gap-3 rounded-2xl bg-foreground/95 px-3.5 py-3 text-background shadow-xl backdrop-blur">
        <div className="relative h-10 w-[120px] shrink-0 overflow-hidden" aria-hidden>
          <span className="swipe-demo-arrow absolute left-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground">
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="absolute left-0 top-1/2 h-5 w-[120px] -translate-y-1/2">
            <span className="swipe-demo-finger absolute left-1 top-0 h-5 w-5 rounded-full border-2 border-background/80 bg-background/40" style={{ animationDuration: "2s" }} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-black leading-tight">Swipe right to go back</div>
          <div className="text-[12px] leading-tight opacity-75">From anywhere on the screen. Try it</div>
        </div>
        <button type="button" onClick={onDismiss} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background/15" aria-label="Hide tip">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
