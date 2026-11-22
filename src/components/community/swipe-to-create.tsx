import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Images, RefreshCcw, X } from "lucide-react";
import { feedback } from "@/lib/feedback";
import {
  CREATE_COMMIT_SHARE,
  CREATE_NO_START,
  FEED_DIM,
  SAFARI_EDGE_PX,
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

/**
 * Swipe to create on Crew's feed (Nov 22 2026): a finger moving right from
 * anywhere on the feed pulls the camera in from the left (where Crew's + is),
 * following the finger with the feed dimming under it; let go past a third of
 * the screen (or flick) and the real camera opens under it, else it slides
 * back. The camera is asked for inside the touch's end (`onOpen`), so a camera
 * already allowed opens without asking again. Never while something else has
 * the screen, from a text box or a video's scrub bar, on a carousel that has
 * moved on from its first slide, or from Safari's own back-swipe edge.
 *
 * Returns the layer (a stand-in of the camera's controls, so the hand-off to
 * the real one is seamless); the caller renders it.
 */
export function useSwipeToCreate({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }): React.ReactNode {
  const shell = useRef<HTMLDivElement | null>(null);
  const dim = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let drag: Drag | null = null;
    // the slide that's still finishing (a new finger waits for it)
    let settling = false;
    let timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const reduce = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const paint = (p: number, ms = 0) => {
      const s = shell.current;
      const d = dim.current;
      if (!s || !d) return;
      const t = ms ? `transform ${ms}ms ${EASE}` : "none";
      s.style.transition = t;
      d.style.transition = ms ? `opacity ${ms}ms ${EASE}` : "none";
      s.style.visibility = "visible";
      d.style.visibility = "visible";
      s.style.transform = `translate3d(${(p - 1) * 100}%,0,0)`;
      d.style.opacity = String(FEED_DIM * p);
    };
    const hide = () => {
      const s = shell.current;
      const d = dim.current;
      if (!s || !d) return;
      s.style.transition = "none";
      d.style.transition = "none";
      s.style.visibility = "hidden";
      d.style.visibility = "hidden";
      s.style.opacity = "1";
      s.style.transform = "translate3d(-100%,0,0)";
      d.style.opacity = "0";
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
        if (intent === "theirs") {
          drag = null;
          return;
        }
        drag.state = "mine";
        // measured from where it was claimed, so the camera never jumps the slop
        drag.x0 = x;
        document.documentElement.setAttribute("data-create-swipe", "");
      }
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      drag.dx = Math.max(0, x - drag.x0);
      drag.points.push({ x, t: e.timeStamp });
      if (drag.points.length > 8) drag.points.shift();
      const p = createProgress(drag.dx, drag.w);
      // one tick as it passes the point where letting go opens it (and back)
      const past = p >= CREATE_COMMIT_SHARE;
      if (past !== drag.past) {
        drag.past = past;
        if (past) feedback("detent");
      }
      paint(p);
    };

    const end = (e: TouchEvent) => {
      const d = drag;
      drag = null;
      if (!d || d.state !== "mine") return;
      swallowClick();
      const speed = swipeSpeed(d.points);
      const p = createProgress(d.dx, d.w);
      const open = createSwipeCommits(d.dx, d.w, speed);
      const ms = reduce() ? 0 : createSettleMs(p, open, speed, d.w);
      settling = true;
      if (!open) {
        paint(0, ms);
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
      paint(1, ms);
      // then the real camera, already open underneath, shows through
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
      if (!d || d.state !== "mine") return;
      settling = true;
      const ms = reduce() ? 0 : 200;
      paint(0, ms);
      later(() => {
        settling = false;
        hide();
      }, ms + 20);
    };

    // capture: seen before anything on a post (the scrub bar, the hold, a carousel) decides
    document.addEventListener("touchstart", start, { passive: true, capture: true });
    document.addEventListener("touchmove", move, { passive: false, capture: true });
    document.addEventListener("touchend", end, { passive: false, capture: true });
    document.addEventListener("touchcancel", cancel, { capture: true });
    return () => {
      document.removeEventListener("touchstart", start, { capture: true });
      document.removeEventListener("touchmove", move, { capture: true });
      document.removeEventListener("touchend", end, { capture: true });
      document.removeEventListener("touchcancel", cancel, { capture: true });
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      hide();
    };
  }, [enabled]);

  if (!enabled || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div ref={dim} className="pointer-events-none fixed inset-0 z-[59] bg-black" style={{ opacity: 0, visibility: "hidden" }} aria-hidden data-create-swipe-dim />
      <CameraStandIn ref={shell} />
    </>,
    document.body,
  );
}

/**
 * What the finger pulls in: the camera as it opens, drawn where the real one
 * draws it (the rounded 9:16 viewfinder, the close button, the shutter, the
 * library, POST · STORY and flip), so when the real camera fades in under it
 * nothing moves.
 */
function CameraStandIn({ ref }: { ref: React.Ref<HTMLDivElement> }) {
  const top = "max(env(safe-area-inset-top), 0.5rem)";
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[60] bg-black text-white will-change-transform"
      style={{ transform: "translate3d(-100%,0,0)", visibility: "hidden" }}
      aria-hidden
      data-create-swipe-shell
    >
      <div className="flex justify-center" style={{ paddingTop: top }}>
        <div
          className="relative rounded-[22px] bg-zinc-900"
          // the story's 9:16, as wide as the screen unless the screen is too short for it
          style={{ width: `min(100%, calc((100dvh - ${top}) * 9 / 16))`, aspectRatio: "9 / 16" }}
        >
          <div className="absolute left-2.5 top-2.5 grid h-11 w-11 place-items-center rounded-full bg-black/40">
            <X className="h-6 w-6" />
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
