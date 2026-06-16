import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { applyUpdate, subscribeSw, getSwStatus } from "@/lib/pwa/register-sw";

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
            const hasUnsaved = document.querySelector('[data-unsaved="true"]');
            if (hasUnsaved && !confirm("You have unsaved work. Update and reload anyway?")) {
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