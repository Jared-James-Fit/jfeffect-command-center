/**
 * A row that scrolls sideways (tabs, chips) fades at an edge only while
 * there's more that way, so a word cut at the screen's edge reads as "more
 * to swipe to", never as broken text, and nothing fades once you're at the end.
 */
import { useEffect, useRef, useState, type CSSProperties, type DependencyList } from "react";

const FADE_PX = 28;

export function scrollFadeMask(start: boolean, end: boolean): CSSProperties | undefined {
  if (!start && !end) return undefined;
  const stops = [
    start ? `transparent 0, #000 ${FADE_PX}px` : "#000 0",
    end ? `#000 calc(100% - ${FADE_PX}px), transparent 100%` : "#000 100%",
  ].join(", ");
  const image = `linear-gradient(to right, ${stops})`;
  return { maskImage: image, WebkitMaskImage: image };
}

export function useScrollFade<T extends HTMLElement = HTMLDivElement>(deps: DependencyList = []) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((cur) => (cur.start === start && cur.end === end ? cur : { start, end }));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", read);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, style: scrollFadeMask(edges.start, edges.end) };
}
