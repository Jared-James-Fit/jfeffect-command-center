import { useEffect } from "react";

type Options = {
  /** Custom prompt for the beforeunload dialog. */
  message?: string;
  /** When false, only mark the document (defer PWA update); skip the beforeunload prompt. Default true. */
  warnOnUnload?: boolean;
};

/**
 * Warn the user before they navigate away from a page with unsaved changes.
 * Also marks `document.body[data-unsaved="true"]` so the PWA update toast
 * can defer updates while edits are in flight.
 *
 * Multiple components may call this concurrently; the marker uses ref-counting
 * so it only clears once every consumer has released.
 */
export function useUnsavedWarning(when: boolean, options: Options | string = {}) {
  const opts: Options = typeof options === "string" ? { message: options } : options;
  const message = opts.message ?? "You have unsaved changes. Leave anyway?";
  const warnOnUnload = opts.warnOnUnload ?? true;

  useEffect(() => {
    if (!when || typeof window === "undefined") return;
    const w = window as unknown as { __jfUnsavedCount?: number };
    w.__jfUnsavedCount = (w.__jfUnsavedCount ?? 0) + 1;
    document.body.setAttribute("data-unsaved", "true");

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    if (warnOnUnload) window.addEventListener("beforeunload", beforeUnload);

    return () => {
      if (warnOnUnload) window.removeEventListener("beforeunload", beforeUnload);
      w.__jfUnsavedCount = Math.max(0, (w.__jfUnsavedCount ?? 1) - 1);
      if ((w.__jfUnsavedCount ?? 0) === 0) {
        document.body.removeAttribute("data-unsaved");
      }
    };
  }, [when, message, warnOnUnload]);
}