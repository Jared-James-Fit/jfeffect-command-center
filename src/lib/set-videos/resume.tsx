/**
 * The app opened again: a set video that was on its way when iOS stopped or
 * closed the app carries on by itself (from the clip kept in the outbox).
 * Cheap on purpose: one IndexedDB count a launch, after the app has painted,
 * and the uploader loads only when something is actually waiting.
 *
 * Later in the launch (once the first posts have loaded) the athlete's own
 * clips the workout film leaves out for their size get their 720p copy
 * (catch-up.ts): one small read, at most every 15 minutes when there's
 * nothing. It looks again when the app comes back on screen (an iPhone's
 * home-screen app is brought back far more often than it's launched) and
 * when a workout's film asks (FEED_COPY_CATCH_UP_EVENT).
 */
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { outboxHasAny } from "@/lib/set-videos/outbox";
import { FEED_COPY_CATCH_UP_EVENT } from "@/lib/set-videos/catch-up-event";

const RESUME_AFTER_MS = 2_500;
/** Catch-up copies start well after the launch, so fetching a clip never slows the first posts. */
const CATCH_UP_AFTER_MS = 20_000;
/** Back on screen: a moment for the screen to settle first. */
const CATCH_UP_ON_RETURN_MS = 5_000;

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
    let looking = false;
    const catchUp = async () => {
      if (cancelled || looking) return;
      looking = true;
      try {
        const { findCatchUpClips } = await import("@/lib/set-videos/catch-up");
        const clips = await findCatchUpClips(uid);
        if (!clips.length || cancelled) return;
        const m = await import("@/lib/set-videos/uploader");
        if (!cancelled) await m.catchUpFeedCopies(uid, clips);
      } finally {
        looking = false;
      }
    };
    const whenIdle = (fn: () => Promise<void>) => {
      const idle = (window as any).requestIdleCallback as
        | ((cb: () => void, o?: { timeout: number }) => number)
        | undefined;
      if (idle) idle(() => void fn().catch(() => {}), { timeout: 3_000 });
      else void fn().catch(() => {});
    };
    const t = window.setTimeout(() => whenIdle(run), RESUME_AFTER_MS);
    let c = window.setTimeout(() => whenIdle(catchUp), CATCH_UP_AFTER_MS);
    const later = (ms: number) => {
      window.clearTimeout(c);
      c = window.setTimeout(() => whenIdle(catchUp), ms);
    };
    const onReturn = () => {
      if (document.visibilityState === "visible") later(CATCH_UP_ON_RETURN_MS);
    };
    const onAsk = () => later(1_000);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener(FEED_COPY_CATCH_UP_EVENT, onAsk);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.clearTimeout(c);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener(FEED_COPY_CATCH_UP_EVENT, onAsk);
    };
  }, [uid]);
  return null;
}
