import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { isNative } from "@/platform";
import { recordVerifiedHomeScreenLaunch } from "@/lib/verified-home-screen.functions";

export function VerifiedHomeScreenTracker({ userId, preview }: { userId?: string; preview: boolean }) {
  const { user } = useAuth();
  const info = usePwaInstall();
  const qc = useQueryClient();
  const record = useServerFn(recordVerifiedHomeScreenLaunch);
  const installed = isNative() || (info.isStandalone && (info.platform === "ios" || info.platform === "android"));
  useEffect(() => {
    if (!installed || preview || !userId || user?.id !== userId) return;
    let busy = false;
    let stopped = false;
    let last = 0;
    const verify = async () => {
      if (stopped || busy || document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      busy = true;
      try {
        await record();
        last = Date.now();
        if (!stopped) {
          void qc.invalidateQueries({ queryKey: ["setup-banner-client", userId] });
          void qc.invalidateQueries({ queryKey: ["home-screen-verification"] });
        }
      } catch { /* offline: retry on focus or connectivity */ }
      finally { busy = false; }
    };
    void verify();
    const retry = () => void verify();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => { stopped = true; window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); };
  }, [installed, preview, userId, user?.id, qc, record]);
  return null;
}
