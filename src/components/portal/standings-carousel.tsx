import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StandingsSlide = { key: string; label: string; node: ReactNode };

/**
 * One card, several boards: swipe between them (or tap the labels). Every
 * slide is as tall as the tallest, so nothing jumps while you swipe. It
 * opens on the board you looked at last (this device only).
 */
export function StandingsCarousel({ slides, storageKey = "jf-home-standings", className }: { slides: StandingsSlide[]; storageKey?: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let i = 0;
    try {
      i = Number(localStorage.getItem(storageKey)) || 0;
    } catch {}
    i = Math.min(Math.max(i, 0), slides.length - 1);
    const el = ref.current;
    if (i > 0 && el) {
      el.scrollLeft = i * el.clientWidth;
      setActive(i);
    }
    // only on first show
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i === active) return;
    setActive(i);
    try {
      localStorage.setItem(storageKey, String(i));
    } catch {}
  };
  const go = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section data-standings className={cn("overflow-hidden rounded-2xl border bg-card", className)}>
      <div role="tablist" aria-label="Your standings" className="flex items-center gap-1 px-3 pt-3">
        {slides.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => go(i)}
            className={cn("h-7 rounded-full px-3 text-[12px] font-bold transition-colors", i === active ? "bg-foreground text-background" : "text-muted-foreground active:bg-muted")}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div ref={ref} onScroll={onScroll} className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {slides.map((s) => (
          <div key={s.key} role="tabpanel" aria-label={s.label} className="w-full min-w-0 shrink-0 snap-center snap-always">
            {s.node}
          </div>
        ))}
      </div>
    </section>
  );
}
