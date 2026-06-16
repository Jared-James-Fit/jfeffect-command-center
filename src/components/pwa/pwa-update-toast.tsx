import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { applyUpdate, subscribeSw, getSwStatus } from "@/lib/pwa/register-sw";
import { getQueueSnapshot } from "@/lib/workout-offline-queue";

function hasUnsavedWork(): boolean {
  // 1. Offline write queue still has pending workout / completion items.
  try {
    if (getQueueSnapshot().length > 0) return true;
  } catch { /* queue not available in this context */ }
  // 2. Any component opted-in via [data-unsaved="true"].
  if (typeof document !== "undefined" && document.querySelector('[data-unsaved="true"]')) return true;
  // 3. Heuristic fallback — non-empty text input/textarea inside a logged-set
  //    or notes surface. Keeps the guard meaningful even when a screen forgets
  //    to set data-unsaved.
  if (typeof document !== "undefined") {
    const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '[data-workout-field] input, [data-workout-field] textarea, textarea[data-notes]'
    );
    for (const f of fields) {
      if (f.value && f.value.trim().length > 0) return true;
    }
  }
  return false;
}

export function PwaUpdateToast() {
  const shown = useRef(false);

  useEffect(() => {
    function show() {
      if (shown.current) return;
      if (getSwStatus() !== "update-available") return;
      shown.current = true;
      toast("JF Effect has been updated", {
        description: "A new version is ready. Update now for the latest fixes.",
        duration: Infinity,
        action: {
          label: "Update",
          onClick: async () => {
            if (hasUnsavedWork() && !confirm("You have unsaved work that hasn't synced yet. Update and reload anyway?")) {
              shown.current = false;
              return;
            }
            await applyUpdate();
          },
        },
        cancel: {
          label: "Later",
          onClick: () => { shown.current = false; },
        },
      });
    }
    const unsub = subscribeSw(show);
    show();
    return () => { unsub(); };
  }, []);

  return null;
}