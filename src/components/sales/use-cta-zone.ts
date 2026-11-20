import { useEffect, useState } from "react";

/**
 * The page section (`data-cta-zone`) covering the middle of the screen, or
 * null: what the header's button follows on the home page, so it asks for
 * the coaching application while coaching is what's being read
 * (sticky-cta.ts has the same rule for the phone's bottom button).
 */
export function useCtaZone(enabled: boolean): string | null {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setZone(null);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const middle = (window.innerHeight || 800) / 2;
      let found: string | null = null;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-cta-zone]"))) {
        const r = el.getBoundingClientRect();
        if (r.top <= middle && r.bottom >= middle) {
          found = el.dataset.ctaZone ?? null;
          break;
        }
      }
      setZone((prev) => (prev === found ? prev : found));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled]);
  return zone;
}
