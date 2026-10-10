import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SwipeCard = { key: string; label: string; node: ReactNode };

/**
 * Several cards in one spot: swipe between them (or tap the labels above).
 * The height follows the card you're on, so a short card never leaves a gap.
 * It opens on the card you looked at last (this device only), or always on
 * the first one with `remember={false}`.
 *
 * Snapping: iOS drops scroll-snap if the scroller changes size mid-swipe, so the
 * height only follows once the swipe has settled, and a settle step always
 * finishes on a whole card, centred (never stuck between two).
 */
export function SwipeCards({
  cards,
  storageKey,
  remember = true,
  className,
}: {
  cards: SwipeCard[];
  storageKey: string;
  remember?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** The card the height follows (changes only once a swipe has settled). */
  const [active, setActive] = useState(0);
  /** The label that's lit while you swipe (cheap, no layout change). */
  const [lit, setLit] = useState(0);
  const settleTimer = useRef<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!remember) return;
    let i = 0;
    try {
      i = Number(localStorage.getItem(storageKey)) || 0;
    } catch {}
    i = Math.min(Math.max(i, 0), cards.length - 1);
    const el = ref.current;
    if (i > 0 && el) {
      el.scrollLeft = i * el.clientWidth;
      setActive(i);
      setLit(i);
    }
    // only on first show
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // follow the height of the card you're on
  useLayoutEffect(() => {
    const el = slideRefs.current[active];
    if (!el) return;
    const sync = () => setHeight(el.offsetHeight);
    sync();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [active]);

  // Once the finger is off and the momentum has stopped: land on the nearest
  // whole card (centred), then let the height follow it.
  const settle = () => {
    settleTimer.current = null;
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    const i = Math.min(Math.max(Math.round(el.scrollLeft / el.clientWidth), 0), cards.length - 1);
    const target = i * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 1) el.scrollTo({ left: target, behavior: "smooth" });
    setLit(i);
    if (i !== active) {
      setActive(i);
      if (remember) {
        try {
          localStorage.setItem(storageKey, String(i));
        } catch {}
      }
    }
  };
  const onScroll = () => {
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i >= 0 && i < cards.length && i !== lit) setLit(i);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settle, 140);
  };
  // Browsers that report the end of a scroll settle right away.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onEnd = () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      settle();
    };
    el.addEventListener("scrollend", onEnd);
    return () => {
      el.removeEventListener("scrollend", onEnd);
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
  });
  const go = (i: number) => {
    const el = ref.current;
    setLit(i);
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section data-swipe-cards={storageKey} className={className}>
      <div role="tablist" className="mb-2 flex items-center gap-1 px-0.5">
        {cards.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={i === lit}
            onClick={() => go(i)}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-bold transition-colors",
              i === lit
                ? "bg-foreground text-background"
                : "text-muted-foreground active:bg-muted",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden overscroll-x-contain transition-[height] duration-300 ease-out [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={height ? { height } : undefined}
      >
        {cards.map((s, i) => (
          <div
            key={s.key}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            role="tabpanel"
            aria-label={s.label}
            className="w-full min-w-0 shrink-0 snap-center snap-always px-px"
          >
            {s.node}
          </div>
        ))}
      </div>
    </section>
  );
}
