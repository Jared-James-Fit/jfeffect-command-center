import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";

// useLayoutEffect warns on the server; this one runs only in the browser.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/**
 * Reveal: a section fades and rises into place the first time it scrolls into
 * view (IntersectionObserver, opacity and transform only, once).
 *
 * The server sends every section visible, so nothing waits on the page's
 * JavaScript: on a slow phone the words and screenshots below the fold are
 * there to read before the app has loaded. Once it has, only sections still
 * below the screen are tucked away (they're off screen, so nobody sees them
 * go) to rise in as they arrive; anything already on screen stays as it is.
 * The GPU hint (will-change) lives only while a section is hidden or moving.
 * Reduced motion: never hidden, never moved.
 */
export function Reveal({
  children,
  delay = 0,
  stagger = 0,
  y = 16,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  delay?: number;
  stagger?: number;
  y?: number;
  as?: any;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // "still": as sent (visible, no transition) · "hidden": waiting below the screen · "rising": on its way in
  const [phase, setPhase] = useState<"still" | "hidden" | "rising">("still");

  useBrowserLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // on screen or above it already: leave it be
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setPhase("hidden");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("rising");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // done rising: drop the transition and the GPU layer
  useEffect(() => {
    if (phase !== "rising") return;
    const t = window.setTimeout(() => setPhase("still"), 700 + delay + stagger * 100 + 50);
    return () => window.clearTimeout(t);
  }, [phase, delay, stagger]);

  const effectiveDelay = delay + stagger * 100;
  const style: CSSProperties | undefined =
    phase === "still"
      ? undefined
      : {
          transition: `opacity 700ms ${EASE}, transform 700ms ${EASE}`,
          transitionDelay: `${effectiveDelay}ms`,
          opacity: phase === "rising" ? 1 : 0,
          transform: phase === "rising" ? "translate3d(0,0,0)" : `translate3d(0,${y}px,0)`,
          willChange: "opacity, transform",
        };

  return (
    <Tag ref={ref as any} className={className} style={style}>
      {children}
    </Tag>
  );
}
