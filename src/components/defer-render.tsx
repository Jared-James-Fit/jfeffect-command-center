import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defers rendering of below-the-fold dashboard sections until the user
 * scrolls them near the viewport, or until the browser is idle. While
 * deferred we render a lightweight skeleton placeholder so the layout
 * doesn't jump. This keeps the first paint focused on above-the-fold
 * essentials (greeting, action centre, water, top quick actions) and
 * lets heavy items (charts, photo lists, event panels, long history)
 * load after the dashboard is visible.
 */
export function DeferRender({
  children,
  placeholderHeight = "h-32",
  rootMargin = "300px",
  idleTimeoutMs = 1500,
}: {
  children: ReactNode;
  placeholderHeight?: string;
  rootMargin?: string;
  idleTimeoutMs?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;

    let cancelled = false;
    const reveal = () => { if (!cancelled) setShown(true); };

    // 1) Reveal when scrolled near the viewport.
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            reveal();
          }
        },
        { rootMargin },
      );
      io.observe(el);
    } else {
      reveal();
    }

    // 2) Fallback: reveal after the browser is idle / a short timeout,
    //    so deferred sections still load even if the user never scrolls.
    const ric =
      (window as any).requestIdleCallback as
        | ((cb: () => void, opts?: { timeout: number }) => number)
        | undefined;
    const idleHandle = ric
      ? ric(reveal, { timeout: idleTimeoutMs })
      : window.setTimeout(reveal, idleTimeoutMs);

    return () => {
      cancelled = true;
      io?.disconnect();
      if (ric && typeof (window as any).cancelIdleCallback === "function") {
        (window as any).cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle as number);
      }
    };
  }, [shown, rootMargin, idleTimeoutMs]);

  if (shown) return <>{children}</>;
  return (
    <div
      ref={ref}
      className={`rounded-2xl border border-border bg-card/40 animate-pulse ${placeholderHeight}`}
      aria-hidden
    />
  );
}