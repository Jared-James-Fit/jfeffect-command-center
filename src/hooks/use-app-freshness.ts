import { useEffect } from "react";
import {
  RUNNING_BUILD, alreadyReloadedFor, decideOnNewBuild, markReloadingFor,
} from "@/lib/app-freshness";
import { flagUpdateAvailable } from "@/lib/pwa/register-sw";
import { hasUnsavedWork } from "@/components/pwa/pwa-update-toast";

const PERIODIC_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;

/** Mount once at the app root. See src/lib/app-freshness.ts. */
export function useAppFreshness() {
  useEffect(() => {
    if (typeof window === "undefined" || RUNNING_BUILD === "dev") return;
    let hiddenAt = 0;
    let lastCheck = 0;
    let busy = false;

    const check = async (awayMs: number) => {
      if (busy) return;
      if (awayMs === 0 && Date.now() - lastCheck < MIN_GAP_MS) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      busy = true;
      lastCheck = Date.now();
      try {
        const { getLiveBuildId } = await import("@/lib/app-version.functions");
        const { build } = await getLiveBuildId();
        const decision = decideOnNewBuild({
          live: build,
          running: RUNNING_BUILD,
          awayMs,
          pathname: window.location.pathname,
          unsaved: hasUnsavedWork(),
          alreadyReloadedFor: alreadyReloadedFor(),
        });
        if (decision === "reload") {
          markReloadingFor(build);
          window.location.reload();
        } else if (decision === "prompt") {
          flagUpdateAvailable();
        }
      } catch {
        // Offline, or the server is mid-deploy: try again next time.
      } finally {
        busy = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      void check(away);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const first = window.setTimeout(() => void check(0), 15_000);
    const every = window.setInterval(() => {
      if (document.visibilityState === "visible") void check(0);
    }, PERIODIC_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);
}
