import * as React from "react";

import { Textarea } from "@/components/ui/textarea";

type Props = React.ComponentProps<"textarea"> & {
  /** Fallback cap when the element has no CSS max-height. */
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
};

/**
 * iMessage-style composer textarea: starts at one row, grows with its content
 * (typing, paste, or any programmatic value change like "Use reply"), shrinks
 * when text is removed, and scrolls internally once it hits its max-height.
 *
 * Sizing runs off the `value` prop in a layout effect, so callers just set
 * state — no per-onChange resize code needed.
 */
const AutoGrowTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  ({ maxHeight = 160, onHeightChange, value, style, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const lastHeight = React.useRef<number>(0);
    const onHeightChangeRef = React.useRef(onHeightChange);
    onHeightChangeRef.current = onHeightChange;

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      const cssMax = parseFloat(getComputedStyle(el).maxHeight);
      const cap = Number.isFinite(cssMax) && cssMax > 0 ? cssMax : maxHeight;
      // Collapse first so scrollHeight reflects the content, not the old box.
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight;
      const full = el.scrollHeight + border;
      const next = Math.min(full, cap);
      el.style.height = `${next}px`;
      el.style.overflowY = full > cap ? "auto" : "hidden";
      if (next !== lastHeight.current) {
        lastHeight.current = next;
        onHeightChangeRef.current?.(next);
      }
    }, [maxHeight]);

    React.useLayoutEffect(() => {
      resize();
    }, [value, resize]);

    // Re-measure when the available width changes (rotation, keyboard,
    // send/mic button swapping in and out next to the field).
    React.useEffect(() => {
      const el = innerRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let lastWidth = el.clientWidth;
      const ro = new ResizeObserver(() => {
        if (el.clientWidth === lastWidth) return;
        lastWidth = el.clientWidth;
        resize();
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [resize]);

    return (
      <Textarea
        ref={setRefs}
        rows={1}
        value={value}
        style={{ overflowY: "hidden", ...style }}
        {...props}
      />
    );
  },
);
AutoGrowTextarea.displayName = "AutoGrowTextarea";

/** Focus a composer and put the caret at the end, scrolled to show it. */
export function focusComposerAtEnd(el: HTMLTextAreaElement | null) {
  if (!el) return;
  // Focus synchronously so iOS Safari opens the keyboard inside the tap.
  el.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {}
    el.scrollTop = el.scrollHeight;
  });
}

export { AutoGrowTextarea };
