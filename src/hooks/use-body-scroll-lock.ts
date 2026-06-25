import { useEffect } from "react";

/**
 * Lock body scroll while `active` is true.
 *
 * Uses the position:fixed + top:-scrollY technique so the background page
 * stays completely still when an overlay (Sheet/Dialog) opens — no jump
 * caused by scrollbar removal or Radix's pointer-events shim.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const body = document.body;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}