import { useEffect } from "react";

/**
 * Tracks the on-screen keyboard and visible viewport on iOS/Android using
 * the Visual Viewport API. Sets the following on <html>:
 *   - data-keyboard-open="true" when the OSK is open
 *   - --keyboard-inset  : px the keyboard occupies (0 when closed)
 *   - --vv-h            : current visualViewport.height in px (visible area)
 *   - --vv-top          : px from the layout viewport top to the visible top
 *
 * Full-bleed surfaces (chat, messenger) anchor themselves to these vars so
 * they precisely match the on-screen visible area instead of relying on
 * 100dvh, which on iOS Safari does NOT shrink when the keyboard opens.
 */
export function useKeyboardOpen() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    let raf = 0;
    // Track the tallest visualViewport.height we've seen as the
    // "no-keyboard" baseline. In iOS PWA / standalone mode both
    // window.innerHeight AND visualViewport.height shrink when the soft
    // keyboard opens, so the classic `innerHeight - vv.height` inset
    // calculation reads 0 and the hook never fires. Comparing against the
    // baseline detects the keyboard reliably in Safari AND in installed
    // PWAs.
    let baseline = vv.height;
    const update = () => {
      raf = 0;
      if (vv.height > baseline) baseline = vv.height;
      const layoutInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const baselineInset = Math.max(0, baseline - vv.height);
      const inset = Math.max(layoutInset, baselineInset);
      // 120px threshold avoids URL-bar collapse / toolbar show-hide
      // false positives while still firing for every real keyboard.
      const open = inset > 120;
      root.style.setProperty("--keyboard-inset", `${open ? inset : 0}px`);
      root.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      if (open) root.setAttribute("data-keyboard-open", "true");
      else root.removeAttribute("data-keyboard-open");
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.removeAttribute("data-keyboard-open");
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    };
  }, []);
}