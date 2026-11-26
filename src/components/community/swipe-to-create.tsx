import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Images, RefreshCcw, Type, X } from "lucide-react";
import { feedback } from "@/lib/feedback";
import { claimGesture, heldByOther, onGestureReset, releaseGesture, targetOwns } from "@/lib/gesture-arena";
import {
  CAMERA_ENTER_EVENT,
  CAMERA_LEAVE_EVENT,
  CREATE_COMMIT_SHARE,
  CREATE_NO_START,
  FEED_EDGE_RADIUS,
  SAFARI_EDGE_PX,
  cameraUnderFeed,
  createProgress,
  createSettleMs,
  createSwipeCommits,
  createSwipeIntent,
  swipeSpeed,
} from "@/lib/swipe-to-create";
import { inClipScrubBand } from "@/lib/video-scrub";
import { CAMERA_MODES, ModeSelector } from "@/components/community/mode-selector";

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
/** The click a browser may still send for a pull comes within this (never long enough to eat a tap on the camera). */
const CLICK_AFTER_PULL_MS = 350;

/** A sideways scroller under the finger that has moved on from its start (a carousel past its first slide): its swipe, not ours. */
function scrolledAcross(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    if (n.scrollWidth > n.clientWidth + 1 && n.scrollLeft > 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

/** Something else has the screen: a sheet, a dialog, a clip held still, a page that locked its scroll. */
function screenBusy(): boolean {
  const html = document.documentElement;
  if (html.hasAttribute("data-clip-held")) return true;
  if (document.body.hasAttribute("data-scroll-locked")) return true;
  return !!document.querySelector("[data-sheet-open], [role=dialog][data-state=open], [role=alertdialog][data-state=open]");
}

/** iPhone Safari's own tab (not the home-screen app), where a swipe from the left edge is the browser's Back. */
function inSafariTab(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === false;
}

type Drag = {
  x0: number;
  y0: number;
  sy: number;
  w: number;
  dx: number;
  state: "wait" | "mine";
  points: { x: number; t: number }[];
  past: boolean;
};

/** What moves with the feed: the posts and stories, Crew's bar and the tab bar (both fixed, so each moves on its own). */
const FEED_LAYERS = "[data-feed-pager], [data-crew-bar], [data-mobile-bottom-nav]";

/**
 * Swipe to create on Crew's feed (Nov 22 2026), Instagram's: a finger moving
 * right from anywhere on the feed pushes the feed (its bars too) off to the
 * right, its leading edge rounded, and the camera is there underneath, moving
 * slower and dimmed until it's in (`cameraUnderFeed`); let go past a third of
 * the screen (or flick) and the real camera opens under the stand-in, else the
 * feed slides back. The camera is asked for inside the touch's end (`onOpen`),
 * so a camera already allowed opens without asking again. Never while
 * something else has the screen, from a text box or a video's scrub bar, on a
 * carousel that has moved on from its first slide, or from Safari's own
 * back-swipe edge. The camera's + opening and its X closing send
 * CAMERA_ENTER_EVENT / CAMERA_LEAVE_EVENT, and the feed makes the same push.
 *
 * Returns the layer (a stand-in of the camera, so the hand-off to the real one
 * is seamless, and the feed edge's rounded corners); the caller renders it.
 */
export function useSwipeToCreate({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }): React.ReactNode {
  const shell = useRef<HTMLDivElement | null>(null);
  const dim = useRef<HTMLDivElement | null>(null);
  const corners = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let drag: Drag | null = null;
    // a slide that's still finishing (a new finger waits for it)
    let settling = false;
    let timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const reduce = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const layers = () => Array.from(document.querySelectorAll<HTMLElement>(FEED_LAYERS));

    /** The feed (and its rounded edge) pushed `x` px to the right. */
    const moveFeed = (x: number, ms = 0) => {
      const t = ms ? `transform ${ms}ms ${EASE}` : "none";
      for (const el of layers()) {
        el.style.willChange = "transform";
        el.style.transition = t;
        el.style.transform = x ? `translate3d(${x}px,0,0)` : "translate3d(0,0,0)";
      }
      const c = corners.current;
      if (c) {
        c.style.visibility = "visible";
        c.style.transition = t;
        c.style.transform = `translate3d(${x}px,0,0)`;
      }
    };
    const releaseFeed = () => {
      for (const el of layers()) {
        el.style.transition = "";
        el.style.transform = "";
        el.style.willChange = "";
      }
      const c = corners.current;
      if (c) {
        c.style.transition = "none";
        c.style.visibility = "hidden";
      }
    };
    /** The camera under the feed at progress p (the feed's edge at p × width). */
    const paint = (p: number, w: number, ms = 0) => {
      const s = shell.current;
      const d = dim.current;
      if (!s || !d) return;
      const { shiftPct, clipRightPct, dim: shade } = cameraUnderFeed(p);
      const t = ms ? `transform ${ms}ms ${EASE}, clip-path ${ms}ms ${EASE}` : "none";
      s.style.transition = t;
      s.style.visibility = "visible";
      s.style.opacity = "1";
      s.style.transform = `translate3d(${shiftPct}%,0,0)`;
      s.style.clipPath = `inset(0 ${clipRightPct}% 0 0)`;
      d.style.transition = ms ? `opacity ${ms}ms ${EASE}` : "none";
      d.style.opacity = String(shade);
      moveFeed(p * w, ms);
    };
    const hide = () => {
      const s = shell.current;
      const d = dim.current;
      if (s) {
        s.style.transition = "none";
        s.style.visibility = "hidden";
        s.style.opacity = "1";
      }
      if (d) d.style.opacity = "0";
      releaseFeed();
      document.documentElement.removeAttribute("data-create-swipe");
    };

    // a pull is never a tap on whatever the finger started on
    const swallowClick = () => {
      const stop = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      document.addEventListener("click", stop, { capture: true, once: true });
      later(() => document.removeEventListener("click", stop, { capture: true }), CLICK_AFTER_PULL_MS);
    };

    const start = (e: TouchEvent) => {
      drag = null;
      if (settling || e.touches.length !== 1) return;
      const target = e.target as Element | null;
      if (!target?.closest?.("[data-feed-pager]")) return;
      if (target.closest(CREATE_NO_START) || screenBusy()) return;
      // something under the finger slides sideways itself (the gesture arena): it keeps the finger
      if (targetOwns(target, "x")) return;
      const { clientX: x, clientY: y } = e.touches[0];
      if (inSafariTab() && x < SAFARI_EDGE_PX) return;
      // a finger on a clip's scrub bar is the bar's
      const page = target.closest(".feed-page, [data-feed-first]");
      if (page && inClipScrubBand(page, x, y)) return;
      if (scrolledAcross(target)) return;
      drag = { x0: x, y0: y, sy: window.scrollY, w: window.innerWidth, dx: 0, state: "wait", points: [{ x, t: e.timeStamp }], past: false };
    };

    const move = (e: TouchEvent) => {
      if (!drag) return;
      // a second finger: a pinch, never this
      if (e.touches.length !== 1) return void cancel();
      const { clientX: x, clientY: y } = e.touches[0];
      const dx = x - drag.x0;
      if (drag.state === "wait") {
        const intent = createSwipeIntent(dx, y - drag.y0, Math.abs(window.scrollY - drag.sy) > 2);
        if (intent === "wait") return;
        if (intent === "theirs" || heldByOther("crew-create") || !claimGesture("crew-create")) {
          drag = null;
          return;
        }
        drag.state = "mine";
        // measured from where it was claimed, so the feed never jumps the slop
        drag.x0 = x;
        document.documentElement.setAttribute("data-create-swipe", "");
      }
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      drag.dx = Math.max(0, x - drag.x0);
      drag.points.push({ x, t: e.timeStamp });
      if (drag.points.length > 8) drag.points.shift();
      const p = createProgress(drag.dx, drag.w);
      // one tick as it passes the point where letting go opens it
      const past = p >= CREATE_COMMIT_SHARE;
      if (past !== drag.past) {
        drag.past = past;
        if (past) feedback("detent");
      }
      paint(p, drag.w);
    };

    const end = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      releaseGesture("crew-create");
      if (!d || d.state !== "mine") return;
      swallowClick();
      const speed = swipeSpeed(d.points);
      const p = createProgress(d.dx, d.w);
      const open = createSwipeCommits(d.dx, d.w, speed);
      const ms = reduce() ? 0 : createSettleMs(p, open, speed, d.w);
      settling = true;
      if (!open) {
        paint(0, d.w, ms);
        later(() => {
          settling = false;
          hide();
        }, ms + 20);
        return;
      }
      // the camera, asked for inside the touch's end (iOS reuses an "Allow" only from a tap)
      e.preventDefault();
      try {
        openRef.current();
      } catch {
        /* the + button still works */
      }
      paint(1, d.w, ms);
      // then the real camera, already open underneath, shows through; the feed goes back behind it
      const reveal = () => {
        const s = shell.current;
        if (!s) return;
        const fade = reduce() ? 0 : 180;
        s.style.transition = fade ? `opacity ${fade}ms ease-out` : "none";
        s.style.opacity = "0";
        later(() => {
          settling = false;
          hide();
        }, fade + 20);
      };
      const ready = Date.now() + 900;
      const wait = () => {
        if (document.querySelector("[data-share-studio]") || Date.now() > ready) reveal();
        else later(wait, 50);
      };
      later(wait, ms + 40);
    };

    const cancel = () => {
      const d = drag;
      drag = null;
      releaseGesture("crew-create");
      if (!d || d.state !== "mine") return;
      settling = true;
      const ms = reduce() ? 0 : 200;
      paint(0, d.w, ms);
      later(() => {
        settling = false;
        hide();
      }, ms + 20);
    };

    // the camera's own opening (+) and closing (X): the feed makes the same push, the camera drawing itself
    const pushed = (to: "away" | "back") => (ev: Event) => {
      const ms = reduce() ? 0 : Number((ev as CustomEvent<{ ms?: number }>).detail?.ms) || 300;
      const w = window.innerWidth;
      settling = true;
      if (to === "away") {
        moveFeed(0);
        requestAnimationFrame(() => moveFeed(w, ms));
        later(() => {
          settling = false;
          releaseFeed();
        }, ms + 60);
      } else {
        moveFeed(w);
        // read once so the jump to the right lands before the slide back starts
        void corners.current?.offsetWidth;
        requestAnimationFrame(() => moveFeed(0, ms));
        later(() => {
          settling = false;
          releaseFeed();
        }, ms + 16);
      }
    };
    const onEnter = pushed("away");
    const onLeave = pushed("back");

    // capture: seen before anything on a post (the scrub bar, the hold, a carousel) decides
    document.addEventListener("touchstart", start, { passive: true, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", end, { passive: false, capture: true });
    document.addEventListener("touchcancel", cancel, { capture: true });
    window.addEventListener(CAMERA_ENTER_EVENT, onEnter);
    window.addEventListener(CAMERA_LEAVE_EVENT, onLeave);
    // the app went away mid-pull: the feed slides back
    const stopReset = onGestureReset(cancel);
    return () => {
      stopReset();
      releaseGesture("crew-create");
      document.removeEventListener("touchstart", start, { capture: true });
      document.removeEventListener("touchmove", move, { capture: true });
      document.removeEventListener("touchend", end, { capture: true });
      document.removeEventListener("touchcancel", cancel, { capture: true });
      window.removeEventListener(CAMERA_ENTER_EVENT, onEnter);
      window.removeEventListener(CAMERA_LEAVE_EVENT, onLeave);
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      hide();
    };
  }, [enabled]);

  if (!enabled || typeof document === "undefined") return null;
  const r = FEED_EDGE_RADIUS;
  return createPortal(
    <>
      <CameraStandIn ref={shell} dimRef={dim} />
      {/* the feed's leading edge, rounded: the camera's black shows in its two corners */}
      <div ref={corners} className="pointer-events-none fixed inset-y-0 left-0 z-[61]" style={{ width: r, visibility: "hidden" }} aria-hidden data-create-swipe-edge>
        <span className="absolute left-0 top-0" style={{ width: r, height: r, background: `radial-gradient(circle at 100% 100%, transparent ${r - 0.5}px, #000 ${r}px)` }} />
        <span className="absolute bottom-0 left-0" style={{ width: r, height: r, background: `radial-gradient(circle at 100% 0%, transparent ${r - 0.5}px, #000 ${r}px)` }} />
      </div>
    </>,
    document.body,
  );
}

/**
 * What the feed is pushed off: the camera as it opens, drawn where the real
 * one draws it (the rounded 9:16 viewfinder, close and the flash, the
 * shutter, the library, POST · STORY and flip), so when the real camera fades
 * in under it nothing moves.
 */
function CameraStandIn({ ref, dimRef }: { ref: React.Ref<HTMLDivElement>; dimRef: React.Ref<HTMLDivElement> }) {
  const top = "max(env(safe-area-inset-top), 0.5rem)";
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[60] bg-black text-white will-change-transform"
      style={{ visibility: "hidden" }}
      aria-hidden
      data-create-swipe-shell
    >
      {/* dark while the feed still mostly covers it, clearing as it comes in */}
      <div ref={dimRef} className="pointer-events-none absolute inset-0 z-10 bg-black" style={{ opacity: 0 }} />
      <div className="flex justify-center" style={{ paddingTop: top }}>
        <div
          className="relative rounded-[22px] bg-zinc-900"
          // the story's 9:16, as wide as the screen unless the screen is too short for it
          style={{ width: `min(100%, calc((100dvh - ${top}) * 9 / 16))`, aspectRatio: "9 / 16" }}
        >
          <div className="absolute left-2.5 top-2.5 grid h-11 w-11 place-items-center rounded-full bg-black/40">
            <X className="h-6 w-6" />
          </div>
          <div className="absolute left-1.5 top-[38%] flex h-12 items-center gap-2.5 pr-3">
            <span className="grid h-11 w-11 place-items-center [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.55))]">
              <Type className="h-7 w-7" strokeWidth={1.9} />
            </span>
            <span className="text-[15px] font-semibold [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]">Type</span>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0">
        <div className="flex h-[88px] items-center justify-center pb-1">
          <span className="grid h-[78px] w-[78px] place-items-center rounded-full border-[5px] border-white">
            <span className="block h-[60px] w-[60px] rounded-full bg-white" />
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 bg-black px-4 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.6rem)" }}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-white/85 bg-white/10">
            <Images className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-1 justify-center">
            <ModeSelector modes={CAMERA_MODES} value="story" onChange={() => undefined} still />
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10">
            <RefreshCcw className="h-5 w-5" />
          </span>
        </div>
      </div>
    </div>
  );
}
