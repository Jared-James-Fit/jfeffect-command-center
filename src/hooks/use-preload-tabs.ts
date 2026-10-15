import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

const START_AFTER_MS = 2500;

/**
 * Fetch the code for the bottom-bar tabs once the app has settled, so the
 * first tap on each one switches instantly instead of waiting on a download.
 * It also keeps those tabs opening after a publish: an app that's been open a
 * while can't always fetch the old build's files once a new one is live.
 * One tab at a time, skipped on Data Saver; a failure just leaves it to the tap.
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
