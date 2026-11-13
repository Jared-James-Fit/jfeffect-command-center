import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * A clip's gestures, Instagram Reels' everywhere a clip plays full size (the
 * Crew feed's own screens and the coach's full-screen clips): a tap is its
 * sound (said in the middle for a moment, SoundFlash), a finger held on it
 * pauses it with the words and buttons out of the way until it lets go
 * (useHoldToPause), and two taps ❤️ where the finger was (ReactionBurst).
 */

/** A finger held this long pauses the clip; one that moves further than HOLD_SLOP_PX first is a swipe. */
export const HOLD_TO_PAUSE_MS = 250;
export const HOLD_SLOP_PX = 10;
/** Letting go of a hold isn't a tap: a click this soon after is ignored. */
export const HOLD_RELEASE_GRACE_MS = 400;

type Hold<T> = { timer: number; x: number; y: number; ctx: T; on: boolean };

/**
 * Press and hold to pause (Reels'). `begin` decides whether this finger can
 * hold (and what it holds, say the clip under it), `onChange` pauses and
 * resumes. A second finger (a pinch) or a finger that moves (a swipe) never
 * holds; the phone's long-press menu never opens while one is down.
 */
export function useHoldToPause<T>(begin: (e: React.PointerEvent) => T | null | undefined, onChange: (ctx: T, held: boolean) => void) {
  const [holding, setHolding] = useState(false);
  const cur = useRef<Hold<T> | null>(null);
  const endedAt = useRef(0);
  const fns = useRef({ begin, onChange });
  fns.current = { begin, onChange };

  const end = useCallback(() => {
    const h = cur.current;
    if (!h) return;
    cur.current = null;
    window.clearTimeout(h.timer);
    if (!h.on) return;
    fns.current.onChange(h.ctx, false);
    setHolding(false);
    endedAt.current = Date.now();
  }, []);
  useEffect(
    () => () => {
      const h = cur.current;
      if (h) window.clearTimeout(h.timer);
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    // a second finger is a pinch (the zoom), never a hold
    if (!e.isPrimary) return end();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const ctx = fns.current.begin(e);
    if (ctx == null) return;
    end();
    const h: Hold<T> = { timer: 0, x: e.clientX, y: e.clientY, ctx, on: false };
    h.timer = window.setTimeout(() => {
      if (cur.current !== h) return;
      h.on = true;
      fns.current.onChange(ctx, true);
      setHolding(true);
    }, HOLD_TO_PAUSE_MS);
    cur.current = h;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const h = cur.current;
    // a finger that moves is a swipe, never a hold
    if (h && !h.on && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) end();
  };
  const onContextMenu = (e: React.MouseEvent) => {
    // a long press on a clip is a pause, never the phone's menu
    if (cur.current || holding) e.preventDefault();
  };
  return {
    holding,
    /** Let go of a hold a moment ago: the click it makes isn't a tap. */
    justReleased: () => Date.now() - endedAt.current < HOLD_RELEASE_GRACE_MS,
    end,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onPointerLeave: end, onContextMenu },
  };
}

/** The sound, on or off, said in the middle of the clip for a moment after a tap (Instagram's). */
export function SoundFlash({ on, onDone }: { on: boolean; onDone: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2] grid place-items-center" aria-hidden data-sound-flash={on ? "on" : "off"}>
      <span className="jf-sound-flash grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white" onAnimationEnd={onDone}>
        {on ? <Volume2 className="h-8 w-8" /> : <VolumeX className="h-8 w-8" />}
      </span>
    </div>
  );
}

/** The sound flash's state: `flash(on)` shows it again (a new one each tap). */
export function useSoundFlash() {
  const [flash, setFlash] = useState<{ on: boolean; n: number } | null>(null);
  const show = useCallback((on: boolean) => setFlash((f) => ({ on, n: (f?.n ?? 0) + 1 })), []);
  const node = flash ? <SoundFlash key={flash.n} on={flash.on} onDone={() => setFlash(null)} /> : null;
  return [node, show] as const;
}
