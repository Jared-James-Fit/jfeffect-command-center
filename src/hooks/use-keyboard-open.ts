import { useEffect } from "react";

/**
 * Tracks the on-screen keyboard (iOS/Android) using VisualViewport and
 * toggles `data-keyboard-open="true"` on <html>. CSS can then react —
 * e.g. hide bottom nav, reposition sticky composers.
 *
 * Also exposes the keyboard height as `--keyboard-inset` (px) on <html>.
 */
export function useKeyboardOpen() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const open = inset > 80; // threshold to avoid URL-bar collapse false positives
      root.style.setProperty("--keyboard-inset", `${open ? inset : 0}px`);
      if (open) root.setAttribute("data-keyboard-open", "true");
      else root.removeAttribute("data-keyboard-open");
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.removeAttribute("data-keyboard-open");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}