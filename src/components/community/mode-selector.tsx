import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { modeAfterSwipe } from "@/lib/mode-selector";

export type CreateMode = { key: string; label: string };

/** What Crew can make from its camera: a post (the feed) or a story (24 hours in the rail). Nothing it can't. */
export const CAMERA_MODES: CreateMode[] = [
  { key: "post", label: "Post" },
  { key: "story", label: "Story" },
];

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * What you're making, Instagram's way (Nov 22 2026): POST · STORY along the
 * bottom. `row` (the camera): the one you're on sits centred under the
 * shutter, white, with a dot under it, and the row slides to the next one;
 * `pill` (the New post screen): a floating pill whose highlight slides. Tap a
 * mode, or swipe the selector itself either way; it follows the finger.
 * `enterFrom`: the mode the last screen was on, so it opens there and slides to
 * this one (the two screens read as one control). `still`: drawn only (the
 * swipe-to-create stand-in).
 */
export function ModeSelector({
  modes,
  value,
  onChange,
  variant = "row",
  enterFrom,
  still = false,
  className,
}: {
  modes: CreateMode[];
  value: string;
  onChange: (key: string) => void;
  variant?: "row" | "pill";
  enterFrom?: string | null;
  still?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLSpanElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  // where it's drawn: the last screen's mode for its first frame, then this one
  const [shown, setShown] = useState(() => (enterFrom && modes.some((m) => m.key === enterFrom) ? enterFrom : value));
  const drag = useRef<{ x0: number; base: number; dx: number; t0: number; moved: boolean } | null>(null);
  const swallow = useRef(false);

  const indexOf = (k: string) => Math.max(0, modes.findIndex((m) => m.key === k));

  /** The row's offset that centres mode `i` (row), or the thumb's box over it (pill). */
  const place = useCallback(
    (i: number, dx = 0, animate = true) => {
      const el = items.current[i];
      const b = box.current;
      if (!el || !b) return 0;
      const t = animate ? `transform 300ms ${EASE}, width 300ms ${EASE}` : "none";
      if (variant === "row") {
        const off = b.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2);
        const tr = track.current;
        if (tr) {
          tr.style.transition = t;
          tr.style.transform = `translate3d(${off + dx}px,0,0)`;
        }
        return off;
      }
      const th = thumb.current;
      if (th) {
        th.style.transition = t;
        th.style.width = `${el.offsetWidth}px`;
        th.style.transform = `translate3d(${el.offsetLeft + dx}px,0,0)`;
      }
      return el.offsetLeft;
    },
    [variant],
  );

  // drawn where it was first (no animation), then it slides to where it is now
  const mounted = useRef(false);
  useLayoutEffect(() => {
    place(indexOf(shown), 0, false);
    mounted.current = true;
    if (shown === value) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setShown(value));
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastValue = useRef(value);
  useLayoutEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    setShown(value);
  }, [value]);
  useLayoutEffect(() => {
    if (mounted.current) place(indexOf(shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, place]);
  // a screen that changes size (a phone turned) keeps it centred
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place(indexOf(shown), 0, false));
    ro.observe(b);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, place]);

  // the caller decides (it may ask first, or open another screen): the selector follows `value`
  const pick = (k: string) => {
    if (still || k === value) return;
    feedback("detent");
    onChange(k);
  };

  // a swipe on the selector itself moves it with the finger, then lands on the next one or back
  const onPointerDown = (e: React.PointerEvent) => {
    if (still || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.stopPropagation();
    swallow.current = false;
    const base = variant === "row" ? place(indexOf(shown), 0, false) : 0;
    drag.current = { x0: e.clientX, base, dx: 0, t0: e.timeStamp, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.dx = ev.clientX - d.x0;
      if (!d.moved && Math.abs(d.dx) < 6) return;
      d.moved = true;
      const i = indexOf(shown);
      // the row's labels move with the finger (left brings the next one in); the pill's highlight does (right is the next one)
      const toward = variant === "row" ? -d.dx : d.dx;
      // past either end it gives a little, never more
      const edge = (i === 0 && toward < 0) || (i === modes.length - 1 && toward > 0);
      place(i, edge ? d.dx / 3 : d.dx, false);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = drag.current;
      drag.current = null;
      if (!d || !d.moved) return;
      swallow.current = true;
      const speed = d.dx / Math.max(1, ev.timeStamp - d.t0);
      const next = modeAfterSwipe(indexOf(shown), modes.length, d.dx, speed, variant === "row" ? "row" : "thumb");
      // back to where it is now; a mode the caller switches to slides on from there
      place(indexOf(shown));
      if (ev.type !== "pointercancel" && next !== indexOf(shown)) pick(modes[next].key);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onClick = (k: string) => {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    pick(k);
  };

  const label = "text-[13px] font-bold uppercase tracking-[0.07em]";
  if (variant === "pill") {
    return (
      <div
        ref={box}
        className={cn("relative flex touch-none select-none rounded-full bg-zinc-800/90 p-1 shadow-lg backdrop-blur-md", className)}
        role="tablist"
        aria-label="Post or story"
        onPointerDown={onPointerDown}
        data-mode-selector="pill"
      >
        <span ref={thumb} className="pointer-events-none absolute inset-y-1 left-0 rounded-full bg-white/15" aria-hidden data-mode-thumb />
        {modes.map((m, i) => (
          <button
            key={m.key}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={m.key === value}
            tabIndex={still ? -1 : undefined}
            onClick={() => onClick(m.key)}
            className={cn("relative min-h-10 rounded-full px-4 transition-colors duration-200", label, m.key === shown ? "text-white" : "text-white/55 active:text-white")}
            data-mode={m.key}
          >
            {m.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      ref={box}
      className={cn("relative w-full touch-none select-none overflow-hidden", className)}
      role={still ? undefined : "tablist"}
      aria-label={still ? undefined : "Post or story"}
      aria-hidden={still || undefined}
      onPointerDown={onPointerDown}
      data-mode-selector={still ? "still" : "row"}
    >
      <div ref={track} className="flex w-max will-change-transform">
        {modes.map((m, i) => (
          <button
            key={m.key}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            role={still ? undefined : "tab"}
            aria-selected={still ? undefined : m.key === value}
            tabIndex={still ? -1 : undefined}
            onClick={() => onClick(m.key)}
            className={cn("h-10 shrink-0 px-3.5 transition-colors duration-200", label, m.key === shown ? "text-white" : "text-white/50 active:text-white/80")}
            data-mode={m.key}
          >
            {m.label}
          </button>
        ))}
      </div>
      {/* the one you're on is always the one over the dot (centred under the shutter) */}
      <span className="pointer-events-none absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" aria-hidden />
    </div>
  );
}
