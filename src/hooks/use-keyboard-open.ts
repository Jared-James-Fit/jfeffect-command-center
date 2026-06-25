import { useEffect, useRef } from "react";

function isImmersiveChatRoute() {
  if (typeof window === "undefined") return false;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/portal/messages") || pathname.startsWith("/admin/messages")) return true;
  if (pathname.startsWith("/admin/communication")) {
    const tab = new URLSearchParams(search).get("tab") ?? "messages";
    return tab === "messages";
  }
  return false;
}

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
  const wasOpenRef = useRef(false);

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
      if (open) {
        root.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
        root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
        root.setAttribute("data-keyboard-open", "true");
      } else {
        // Keyboard closed: pin viewport vars to the full window so the
        // chat surface doesn't get stuck offset by a stale visualViewport
        // scroll position (iOS leaves vv.offsetTop > 0 after the input
        // blurs, which would leave a huge empty band above the tabs).
        root.style.setProperty("--vv-h", `${Math.round(window.innerHeight)}px`);
        root.style.setProperty("--vv-top", "0px");
        root.removeAttribute("data-keyboard-open");
        if (wasOpenRef.current && isImmersiveChatRoute() && (vv.offsetTop > 0 || window.scrollY > 0)) {
          window.scrollTo({ top: 0, left: 0 });
        }
      }
      wasOpenRef.current = open;
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