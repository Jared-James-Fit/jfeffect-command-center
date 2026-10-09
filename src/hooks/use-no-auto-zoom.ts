import { useEffect } from "react";

/**
 * iOS zooms the whole page in when a text box under 16px gets focus, and leaves it zoomed
 * after the keyboard closes (the share studio's text tool draws its letters at the card's
 * true scale, so small text sizes trip it). While `active`, the viewport is capped at 1×,
 * which stops that auto-zoom without changing how anything looks. Restored on cleanup.
 * Nested users are counted, so the cap only lifts when the last one lets go.
 */
let holders = 0;
let original: string | null = null;

const meta = () => (typeof document === "undefined" ? null : document.querySelector<HTMLMetaElement>('meta[name="viewport"]'));

export function capViewport(content: string): string {
  const parts = content.split(",").map((p) => p.trim()).filter((p) => p && !/^maximum-scale\s*=/i.test(p));
  return [...parts, "maximum-scale=1"].join(", ");
}

export function useNoAutoZoom(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const m = meta();
    if (!m) return;
    if (holders++ === 0) {
      original = m.getAttribute("content") ?? "width=device-width, initial-scale=1";
      m.setAttribute("content", capViewport(original));
    }
    return () => {
      if (--holders > 0) return;
      const cur = meta();
      if (cur && original != null) cur.setAttribute("content", original);
      original = null;
    };
  }, [active]);
}
