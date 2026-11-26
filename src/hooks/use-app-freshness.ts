import { useEffect } from "react";
import {
  NEW_VISIT_AWAY_MS,
  RESUME_MIN_AWAY_MS,
  RUNNING_BUILD,
  alreadyReloadedFor,
  decideOnNewBuild,
  markReloadingFor,
} from "@/lib/app-freshness";
import { hasUnsavedWork } from "@/lib/app-busy";
import { noteReloadReason } from "@/lib/demo-crumb";

/** While out of sight (a computer's background tab keeps its timers), look again this often. */
const HIDDEN_POLL_MS = 5 * 60_000;

/** Mount once at the app root. Picks up a new build quietly; never asks. See src/lib/app-freshness.ts. */
export function useAppFreshness() {
  useEffect(() => {
    if (typeof window === "undefined" || RUNNING_BUILD === "dev") return;
    let hiddenAt = 0;
    let busy = false;
    let hiddenTimer = 0;

    const check = async (awayMs: number, hidden: boolean) => {
      if (busy) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      busy = true;
      try {
        const { getLiveBuildId } = await import("@/lib/app-version.functions");
        const { build } = await getLiveBuildId();
        const decision = decideOnNewBuild({
          live: build,
          running: RUNNING_BUILD,
          awayMs,
          hidden,
          pathname: window.location.pathname,
          unsaved: await hasUnsavedWork(),
          alreadyReloadedFor: alreadyReloadedFor(),
        });
        // still out of sight / still on the same screen? (the answer took a moment)
        if (decision === "reload" && (document.visibilityState === "hidden") === hidden) {
          markReloadingFor(build);
          noteReloadReason(hidden ? "new build in the background" : "new build on reopen");
          window.location.reload();
        }
      } catch {
        // Offline, or the server is mid-deploy: try again next time.
      } finally {
        busy = false;
      }
    };

    const stopHiddenTimer = () => {
      if (hiddenTimer) window.clearInterval(hiddenTimer);
      hiddenTimer = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        stopHiddenTimer();
        hiddenTimer = window.setInterval(() => {
          const away = Date.now() - hiddenAt;
          if (away >= NEW_VISIT_AWAY_MS) void check(away, true);
        }, HIDDEN_POLL_MS);
        return;
      }
      stopHiddenTimer();
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      // a quick glance away can't reload anything (decideOnNewBuild), so it asks nothing
      if (away >= RESUME_MIN_AWAY_MS) void check(away, false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopHiddenTimer();
    };
  }, []);
}
