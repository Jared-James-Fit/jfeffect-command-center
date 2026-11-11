/**
 * The app opened again: a set video that was on its way when iOS stopped or
 * closed the app carries on by itself (from the clip kept in the outbox).
 * Cheap on purpose: one IndexedDB count a launch, after the app has painted,
 * and the uploader loads only when something is actually waiting.
 */
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { outboxHasAny } from "@/lib/set-videos/outbox";

const RESUME_AFTER_MS = 2_500;

export function SetVideoResume() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid || typeof window === "undefined") return;
    let cancelled = false;
    const run = async () => {
      if (cancelled || !(await outboxHasAny(uid)) || cancelled) return;
      const m = await import("@/lib/set-videos/uploader");
      if (!cancelled) await m.resumeSetVideos(uid);
    };
    const t = window.setTimeout(() => {
      const idle = (window as any).requestIdleCallback as
        | ((cb: () => void, o?: { timeout: number }) => number)
        | undefined;
      if (idle) idle(() => void run().catch(() => {}), { timeout: 3_000 });
      else void run().catch(() => {});
    }, RESUME_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [uid]);
  return null;
}
