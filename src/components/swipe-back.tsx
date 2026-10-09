import { useEffect, useRef, type RefObject } from "react";
import { ChevronLeft, X } from "lucide-react";

/** The phone's own edge swipe lives here: leave it to the phone. */
const EDGE_PX = 24;
/** How far a finger moves before we decide what kind of gesture it is (not twitchy). */
const LOCK_PX = 12;
/** Sideways must clearly beat up/down, so scrolling never turns into a swipe. */
const DIRECTION = 1.4;
/** Letting go past this goes back: a short, comfortable thumb move (~85px on a phone). */
export const commitDistance = (w: number) => Math.min(110, Math.max(64, w * 0.22));
/** Or a flick (px per ms) once it has moved a little. */
const FLICK = 0.32;
const FLICK_MIN_PX = 28;
/** The page follows 1:1 up to the commit point, then with resistance, and never further than this. */
const MAX_SHARE = 0.42;

/**
 * Finger travel → how far the page moves: 1:1 until it would go back, then it gets heavier
 * (rubber band) and stops well before the edge, so there's never an empty screen beside it.
 */
export function swipeOffset(dx: number, w: number): number {
  if (dx <= 0) return 0;
  const c = commitDistance(w);
  if (dx <= c) return dx;
  return Math.min(w * MAX_SHARE, c + (dx - c) * 0.4);
}

/** Should letting go here go back? */
export function shouldGoBack(dx: number, speed: number, w: number): boolean {
  return dx >= commitDistance(w) || (speed > FLICK && dx > FLICK_MIN_PX);
}

/**
 * Swipe right from anywhere on the screen to go back (not just the very edge). The page
 * follows your thumb, a "Back" strip fills the space it opens up (never a black gap), and a
 * short move or a quick flick is enough. Going back fades the page out and the next one in.
 *
 * Stays out of the way of everything else: vertical scrolling, open sheets and dialogs, text
 * fields, anything marked `data-no-swipe-back`, and a sideways scroller that can still scroll
 * back (a carousel past its first photo swipes the carousel; on its first photo, it's a back
 * swipe). Every frame is a transform on the GPU, painted once per animation frame.
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
  const strip = useRef<HTMLDivElement | null>(null);
  const arrow = useRef<HTMLDivElement | null>(null);
  const cb = useRef({ onBack, onUsed });
  cb.current = { onBack, onUsed };

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let start: { x: number; y: number } | null = null;
    let mode: "undecided" | "back" | "off" = "off";
    let dx = 0;
    let y = 0;
    let lastX = 0;
    let lastT = 0;
    let speed = 0;
    let armed = false;
    let leaving = false;
    let frame = 0;

    const blocked = (el: EventTarget | null) => {
      if (!(el instanceof Element)) return true;
      if (el.closest('[role="dialog"],[role="alertdialog"],[data-no-swipe-back],input,textarea,select,[contenteditable="true"]')) return true;
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollLeft > 0 && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const sheetOpen = () => !!document.querySelector('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]');
    const EASE = "cubic-bezier(.22,.9,.25,1)";

    const paint = (x: number, animate: number | false) => {
      const el = target.current;
      const w = window.innerWidth || 1;
      const p = Math.min(1, x / commitDistance(w));
      const t = animate ? `${animate}ms ${EASE}` : "none";
      if (el) {
        el.style.transition = animate ? `transform ${t}` : "none";
        el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
      }
      if (strip.current) {
        // the strip is as wide as the page could ever move; it slides in with the page
        strip.current.style.transition = animate ? `transform ${t}, opacity ${t}` : "none";
        strip.current.style.transform = `translate3d(${x - w * MAX_SHARE}px,0,0)`;
        strip.current.style.opacity = x ? "1" : "0";
      }
      if (arrow.current) {
        arrow.current.style.transition = animate ? `transform ${t}, opacity ${t}` : "none";
        arrow.current.style.top = `${Math.max(90, Math.min(window.innerHeight - 150, y - 22))}px`;
        arrow.current.style.opacity = String(Math.min(1, p * 1.4));
        arrow.current.style.transform = `translate3d(${Math.max(0, x / 2 - 22)}px,0,0) scale(${0.7 + 0.3 * p})`;
        arrow.current.dataset.armed = p >= 1 ? "1" : "0";
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (mode === "back") paint(swipeOffset(dx, window.innerWidth), false);
      });
    };
    const lift = (on: boolean) => {
      const el = target.current;
      if (!el) return;
      // one soft edge shadow for the whole gesture (not repainted every frame)
      el.style.boxShadow = on ? "-10px 0 24px rgba(0,0,0,.16)" : "";
      el.style.willChange = on ? "transform" : "";
    };
    const reset = () => {
      const el = target.current;
      if (el) {
        el.style.transition = "";
        el.style.transform = "";
        el.style.opacity = "";
        el.style.boxShadow = "";
        el.style.willChange = "";
      }
      if (strip.current) strip.current.style.opacity = "0";
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
      y = t.clientY;
      speed = 0;
      armed = false;
      lastX = t.clientX;
      lastT = e.timeStamp;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || mode === "off") return;
      if (e.touches.length !== 1) {
        mode = "off";
        lift(false);
        paint(0, 200);
        return;
      }
      const t = e.touches[0];
      const ddx = t.clientX - start.x;
      const ddy = t.clientY - start.y;
      if (mode === "undecided") {
        if (Math.abs(ddx) < LOCK_PX && Math.abs(ddy) < LOCK_PX) return;
        if (ddx > 0 && ddx > Math.abs(ddy) * DIRECTION) {
          mode = "back";
          lift(true);
          // start from where the finger is now, so the page doesn't jump by the lock distance
          start = { x: t.clientX - LOCK_PX, y: start.y };
        } else {
          mode = "off";
          return;
        }
      }
      // ours now: no scrolling underneath
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, t.clientX - start.x);
      y = t.clientY;
      const dt = e.timeStamp - lastT;
      // smoothed velocity, so one jittery sample can't fire a flick
      if (dt > 0) speed = speed * 0.4 + ((t.clientX - lastX) / dt) * 0.6;
      lastX = t.clientX;
      lastT = e.timeStamp;
      const over = dx >= commitDistance(window.innerWidth);
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
      schedule();
    };
    const onEnd = () => {
      if (!start || mode !== "back") {
        start = null;
        mode = "off";
        return;
      }
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      const w = window.innerWidth;
      const go = shouldGoBack(dx, speed, w);
      start = null;
      mode = "off";
      if (!go) {
        paint(0, 220);
        window.setTimeout(() => lift(false), 230);
        return;
      }
      leaving = true;
      // glide a little further and fade (no empty screen), then go back
      const el = target.current;
      paint(Math.min(w * MAX_SHARE, Math.max(swipeOffset(dx, w), commitDistance(w)) + 40), 160);
      if (el) {
        el.style.transition = `transform 160ms ${EASE}, opacity 160ms ease-out`;
        el.style.opacity = "0";
      }
      window.setTimeout(() => {
        cb.current.onUsed?.();
        cb.current.onBack();
        // went back inside the same page (profile → feed)? bring the new content in from the left
        requestAnimationFrame(() => {
          const node = target.current;
          if (strip.current) strip.current.style.opacity = "0";
          if (arrow.current) arrow.current.style.opacity = "0";
          if (node && node.isConnected) {
            node.style.transition = "none";
            node.style.transform = "translate3d(-24px,0,0)";
            node.style.opacity = "0";
            node.style.boxShadow = "";
            requestAnimationFrame(() => {
              node.style.transition = `transform 220ms ${EASE}, opacity 180ms ease-out`;
              node.style.transform = "";
              node.style.opacity = "";
              window.setTimeout(() => {
                reset();
                leaving = false;
              }, 240);
            });
          } else {
            leaving = false;
          }
        });
      }, 150);
    };
    const onCancel = () => {
      if (mode === "back") {
        paint(0, 200);
        window.setTimeout(() => lift(false), 210);
      }
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
      if (frame) cancelAnimationFrame(frame);
      reset();
    };
  }, [enabled, target]);

  if (!enabled) return null;
  return (
    <>
      {/* fills the space the page opens up with the app's own surface (never a black gap); under the top bar and tabs */}
      <div
        ref={strip}
        aria-hidden
        className="pointer-events-none fixed inset-y-0 left-0 z-30 bg-gradient-to-r from-muted to-background opacity-0"
        style={{ width: "42vw", transform: "translate3d(-42vw,0,0)" }}
      />
      <div
        ref={arrow}
        aria-hidden
        className="pointer-events-none fixed left-0 z-[60] grid h-11 w-11 place-items-center rounded-full bg-card text-foreground opacity-0 shadow-md ring-1 ring-border transition-colors data-[armed=1]:bg-primary data-[armed=1]:text-primary-foreground data-[armed=1]:ring-primary"
        style={{ top: "45%" }}
      >
        <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
      </div>
    </>
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
