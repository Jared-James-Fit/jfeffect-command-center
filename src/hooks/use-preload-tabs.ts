import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

const START_AFTER_MS = 2500;

/** Resolves once the browser has an idle moment (or after `timeout`), so a tab's code never competes with what's on screen. */
function idleMoment(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout });
    else window.setTimeout(resolve, 50);
  });
}

/**
 * Fetch the code for the bottom-bar tabs once the app has settled, so the
 * first tap on each one switches instantly instead of waiting on a download.
 * It also keeps those tabs opening after a publish: an app that's been open a
 * while can't always fetch the old build's files once a new one is live.
 * One tab at a time, each in an idle moment (so the screen being looked at,
 * its images and its first scroll, go first), skipped on Data Saver and while
 * the app is in the background; a failure just leaves it to the tap.
 */
export function usePreloadTabs(paths: readonly string[]) {
  const router = useRouter();
  const key = paths.join("|");
  useEffect(() => {
    if (typeof window === "undefined" || !key) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      for (const to of key.split("|")) {
        if (cancelled) return;
        await idleMoment(3000);
        if (cancelled || document.visibilityState === "hidden") return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await router.preloadRoute({ to } as any);
        } catch {
          /* the tap loads it */
        }
      }
    }, START_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [router, key]);
}
