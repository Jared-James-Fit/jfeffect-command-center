import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Its child at full size when it fits the box, else scaled down to fit it (a
 * workout's card above a small phone's words, or above its open sheet):
 * never cut off, never scrolling on its own (a vertical swipe is the feed's).
 * Only the card is scaled, never the post's screen.
 */
export function FitScale({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    // offsetHeight is the card's own height, whatever it's scaled to
    const read = () =>
      setScale(
        i.offsetHeight > 0 && o.clientHeight > 0
          ? Math.min(1, Math.floor((o.clientHeight / i.offsetHeight) * 1000) / 1000)
          : 1,
      );
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={outer}
      className="flex h-full w-full items-center justify-center overflow-hidden"
      data-fit-scale={scale < 1 ? scale : undefined}
    >
      <div
        ref={inner}
        className="w-full origin-center"
        style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
