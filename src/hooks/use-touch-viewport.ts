import { useEffect, useState } from "react";

/**
 * Touch/keyboard-aware helpers for modal forms.
 *
 * Android Chrome fights programmatic focus that happens while a dialog is
 * still animating in: Radix focuses the dialog container on open, React's
 * `autoFocus` then focuses the input, the soft keyboard + autofill strip
 * open, and focus lands back on the container — leaving a visible keyboard
 * that types into nothing. Detecting a coarse pointer lets us skip auto-focus
 * on touch devices while keeping it on desktop.
 */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function useIsCoarsePointer(): boolean {
  // Resolved during the first render (not in an effect): React applies
  // `autoFocus` and Radix fires `onOpenAutoFocus` on mount, so an
  // effect-based value would arrive one render too late to suppress them.
  // Dialogs render client-side only, so there is no hydration mismatch.
  const [coarse] = useState(() => isCoarsePointer());
  return coarse;
}

/**
 * Height of the *visual* viewport (i.e. excluding the on-screen keyboard).
 * `dvh`/`vh` do not shrink when the Android keyboard opens, so a centred
 * dialog can end up half-buried; sizing off `visualViewport` keeps the form
 * scrollable above the keyboard. Returns null until measured (SSR-safe).
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const read = () => setHeight(vv ? vv.height : window.innerHeight);
    read();
    if (!vv) {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);
  return height;
}
