/**
 * The home page's reveals move one way (what a trainer and online coaching
 * cost, the free app's $0, Coaching Plus, then Complete Online Coaching): a
 * reveal, never a gate.
 *
 * Everything is on the page from the first paint (server-rendered, readable
 * with no script). Once the page is interactive, a stage that's still below
 * the screen is held back and eases in the first time it's scrolled to.
 * Nothing stops scrolling, nothing waits on a timer, a stage already on
 * screen (a jump to #pricing, a reload half way down) is never hidden, and
 * with reduced motion there's no motion at all.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { trackSite } from "@/lib/site-funnel";
import type { SiteEvent } from "@/lib/site-funnel-rules";

export type Phase = "static" | "armed" | "shown";

/**
 * A stage that eases in the first time it's scrolled to: "static" (shown as
 * is: the server's render, reduced motion, or already on screen when the page
 * woke), "armed" (below the screen, held back) or "shown" (scrolled to).
 */
export function useStage(threshold: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // already on screen, or above it: leave it exactly as it is
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setPhase("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("shown");
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, phase] as const;
}

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** One element's part in a stage: where it starts while held back, and when it moves. */
export function motion(
  phase: Phase,
  { delay = 0, y = 18, scale = 1, duration = 700, blur = 0 }: { delay?: number; y?: number; scale?: number; duration?: number; blur?: number } = {},
): CSSProperties | undefined {
  if (phase === "static") return undefined;
  const held = phase === "armed";
  return {
    opacity: held ? 0 : 1,
    transform: held ? `translate3d(0, ${y}px, 0) scale(${scale})` : "none",
    filter: blur ? (held ? `blur(${blur}px)` : "blur(0)") : undefined,
    transition: `opacity ${duration}ms ${EASE} ${delay}ms, transform ${duration}ms ${EASE} ${delay}ms${blur ? `, filter ${duration}ms ${EASE} ${delay}ms` : ""}`,
  };
}

/** The settle a price makes as it's revealed: from a little smaller and soft focus, slowly. */
export const PRICE_SETTLE = { delay: 220, y: 34, scale: 0.94, duration: 1000, blur: 8 } as const;

/** The free app's $0, the page's biggest moment: the same settle, from further and softer, a beat longer. */
export const FREE_SETTLE = { delay: 260, y: 44, scale: 0.88, duration: 1200, blur: 14 } as const;

/** Counts a moment once, when enough of it is on screen (with or without motion). */
export function useSeen(ref: RefObject<HTMLElement | null>, event: SiteEvent, step: string, threshold = 0.45) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          trackSite(event, step);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, event, step, threshold]);
}
