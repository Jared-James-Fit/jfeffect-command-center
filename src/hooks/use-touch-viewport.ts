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

/**
 * The visible part of the screen (top offset + height). When the on-screen
 * keyboard opens it shrinks, and on iOS the page also slides up under it, so
 * a full-screen overlay pinned to this box keeps its controls in view, right
 * above the keyboard. `keyboard` is true while the keyboard is up (the
 * visible height is well below the tallest seen; that also holds in an
 * installed PWA, where window.innerHeight shrinks too).
 */
export function useVisualViewportBox(active: boolean) {
  const [box, setBox] = useState<{ top: number; height: number; keyboard: boolean } | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    let tallest = 0;
    const update = () => {
      const height = vv ? vv.height : window.innerHeight;
      tallest = Math.max(tallest, height, window.innerHeight);
      setBox({ top: vv ? vv.offsetTop : 0, height, keyboard: tallest - height > 120 });
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      setBox(null); // next time starts fresh, not from a stale keyboard position
    };
  }, [active]);
  return active ? box : null;
}
