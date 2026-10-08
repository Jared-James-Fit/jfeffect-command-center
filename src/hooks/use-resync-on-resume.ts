// Catch up on anything realtime missed while the app wasn't listening.
//
// Supabase realtime only delivers events while the socket is connected, and
// never replays what it missed. iOS suspends the socket whenever the app is
// backgrounded or the phone locks, and the app-wide query defaults turn off
// refetch-on-focus. Net effect before this: open the app from a message
// notification and the inbox showed whatever it had before you locked the
// phone, until some *later* event happened to trigger a refresh.
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const MIN_GAP_MS = 2_000; // visibilitychange + focus + pageshow often fire together

/**
 * Calls `resync` when the page comes back after being hidden (app resumed,
 * tab re-shown, restored from bfcache) or the device comes back online.
 */
export function useResyncOnResume(resync: () => void, enabled = true) {
  const ref = useRef(resync);
  ref.current = resync;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let wasHidden = document.visibilityState === "hidden";
    let lastFired = 0;
    const fire = () => {
      const now = Date.now();
      if (now - lastFired < MIN_GAP_MS) return;
      lastFired = now;
      // A suspended socket may still be waiting on a throttled backoff timer.
      try {
        if (!supabase.realtime.isConnected()) supabase.realtime.connect();
      } catch { /* realtime unavailable: the refetch below still catches up */ }
      ref.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { wasHidden = true; return; }
      if (wasHidden) { wasHidden = false; fire(); }
    };
    const onFocus = () => { if (wasHidden) { wasHidden = false; fire(); } };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) fire(); };
    const onOnline = () => fire();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);
}

/**
 * Status callback for `channel.subscribe()`. Supabase re-runs it with
 * SUBSCRIBED each time the channel rejoins after a drop; any rejoin (not the
 * first join) means events may have been missed, so `onRejoin` resyncs.
 */
export function onRealtimeRejoin(onRejoin: () => void) {
  let joined = false;
  return (status: string) => {
    if (status !== "SUBSCRIBED") return;
    if (joined) onRejoin();
    joined = true;
  };
}
