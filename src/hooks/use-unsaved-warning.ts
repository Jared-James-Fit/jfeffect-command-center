import { useEffect } from "react";

/**
 * Warn the user before they navigate away from a page with unsaved changes.
 * Also marks the document so the PWA update toast can defer.
 */
export function useUnsavedWarning(when: boolean, message = "You have unsaved changes. Leave anyway?") {
  useEffect(() => {
    if (!when || typeof window === "undefined") return;
    document.body.setAttribute("data-unsaved", "true");

    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.body.removeAttribute("data-unsaved");
    };
  }, [when, message]);
}