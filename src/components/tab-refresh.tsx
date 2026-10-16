import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActivitySpinner } from "@/components/activity-spinner";
import { MIN_SPIN_MS, PULL_RECENT_MS, RECENT_MS, TAB_REFRESH_EVENT, canStartPull, needsRefresh, pullProgress } from "@/lib/tab-refresh";

type Phase = "idle" | "pulling" | "refreshing" | "done";
/** The room the page makes for the spinner while it loads. */
const GAP = 46;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/**
 * The page's refresher, first thing in the page under the top bar. The bar's
 * re-tap asks it to refresh (TAB_REFRESH_EVENT), and on a tab's own page a
 * pull down from the very top does too. Instagram's spinner shows while it
 * loads, in room the page makes for it; during a pull it fills in tick by tick
 * and refreshes once you let go past the mark. It reloads only what's on
 * screen, never what just loaded.
 *
 * Its own small component, so a pull re-renders just the spinner, not the app.
 */
export function TabRefresh({ pull: pullEnabled, top }: {
  /** Pull to refresh here (a tab's own page, on a phone). */
  pull: boolean;
  /** Where the chip rests: in the room just under the page's top bar. */
  top: string;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pull, setPull] = useState(0);
  const busy = useRef(false);
  const pullRef = useRef(0);

  const refresh = useCallback(async (pulled: boolean) => {
    if (busy.current) return;
    // never while something is still saving (a moved workout, a logged set): a reload could put the old version back
    if (qc.isMutating() > 0) {
      if (pulled) setPhase("done");
      return;
    }
    const now = Date.now();
    const hashes = new Set(
      qc.getQueryCache().findAll({ type: "active" })
        .filter((q) => needsRefresh(q.state, now, pulled ? PULL_RECENT_MS : RECENT_MS))
        .map((q) => q.queryHash),
    );
    // a tap with nothing old enough on screen is just the trip to the top
    if (!hashes.size && !pulled) return;
    busy.current = true;
    setPhase("refreshing");
    const t0 = Date.now();
    try {
      // join what's already loading (a page's own retap refresh) instead of restarting it
      await Promise.race([
        hashes.size ? qc.refetchQueries({ type: "active", predicate: (q) => hashes.has(q.queryHash) }, { cancelRefetch: false }) : Promise.resolve(),
        sleep(8_000),
      ]);
    } catch {
      /* the page shows its own errors */
    }
    await sleep(Math.max(0, MIN_SPIN_MS - (Date.now() - t0)));
    busy.current = false;
    setPhase("done");
  }, [qc]);

  // the bar's re-tap
  useEffect(() => {
    const onRefresh = () => void refresh(false);
    window.addEventListener(TAB_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TAB_REFRESH_EVENT, onRefresh);
  }, [refresh]);

  // fade out, then gone
  useEffect(() => {
    if (phase !== "done") return;
    const t = window.setTimeout(() => setPhase("idle"), 220);
    return () => window.clearTimeout(t);
  }, [phase]);

  // pull down from the top: follows the finger, never blocks the page's own scrolling or bounce
  useEffect(() => {
    if (!pullEnabled) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    const SLOP = 12;
    const reset = () => {
      start = null;
      pulling = false;
    };
    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1 || !canStartPull(e.target)) return reset();
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pulling = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      // something else took this gesture (dragging a workout on the calendar, a slider): not a pull
      if (e.defaultPrevented) {
        if (pulling) {
          pullRef.current = 0;
          setPull(0);
          setPhase("done");
        }
        return reset();
      }
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      const dx = t.clientX - start.x;
      if (!pulling) {
        // sideways (carousels, swipe back) or scrolling the page down: not a pull
        if ((Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) || dy < -4 || window.scrollY > 0) return reset();
        if (dy <= SLOP || dy < Math.abs(dx) * 1.3) return;
        pulling = true;
      }
      const p = pullProgress(dy - SLOP);
      pullRef.current = p;
      setPull(p);
      setPhase("pulling");
    };
    const onEnd = () => {
      if (!pulling) return reset();
      const go = pullRef.current >= 1;
      pullRef.current = 0;
      setPull(0);
      reset();
      if (go) void refresh(true);
      else setPhase("done");
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [pullEnabled, refresh]);

  const pulling = phase === "pulling";
  const scale = pulling ? 0.72 + 0.28 * pull : phase === "done" ? 0.6 : 1;
  const opacity = pulling ? Math.min(1, pull * 1.6) : phase === "done" ? 0 : 1;
  return (
    <>
    {/* While it loads, the page eases down to make room under the bar (Instagram's), then closes back up.
        (During a pull the phone's own bounce makes the room.) */}
    <div aria-hidden className="md:hidden" style={{ height: phase === "refreshing" ? GAP : 0, transition: "height 240ms cubic-bezier(0.2, 0.8, 0.2, 1)" }} data-tab-refresh-gap />
    {phase !== "idle" && <div
      className="pointer-events-none fixed inset-x-0 z-[39] flex justify-center md:hidden"
      style={{ top }}
      role="status"
      aria-live="polite"
      data-tab-refresh={phase}
    >
      <span className="sr-only">{phase === "refreshing" ? "Refreshing" : ""}</span>
      <span
        // just the spinner, Instagram's: it sits in the room the page (or the phone's bounce) makes for it
        className="grid h-9 w-9 place-items-center text-muted-foreground"
        style={{
          opacity,
          transform: `translateY(${pulling ? (pull - 1) * 14 : 0}px) scale(${scale})`,
          transition: pulling ? "none" : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease-out",
        }}
      >
        <ActivitySpinner size={26} spinning={!pulling} shown={pulling ? Math.ceil(pull * 8) : 8} />
      </span>
    </div>}
    </>
  );
}
