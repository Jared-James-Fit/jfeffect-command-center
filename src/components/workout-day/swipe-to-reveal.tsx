import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * iOS-style swipe-to-reveal for workout exercise cards.
 *
 *  - Touch slop: nothing moves until the finger travels SLOP px.
 *  - Direction lock: the gesture becomes a swipe only if it is clearly
 *    horizontal (|dx| >= LOCK_RATIO * |dy|); a vertical/diagonal start locks
 *    into "scroll" for the rest of the gesture and the card never moves.
 *  - Resistance: the card tracks the finger, rubber-banding past the action.
 *  - Release: snaps open (deliberate distance or a real flick past MIN_FLICK)
 *    or closed. It never stays half-open and never deletes on its own —
 *    the Delete button must still be tapped.
 *  - One open card at a time; tapping elsewhere or scrolling closes it.
 *  - Gestures that start on inputs or [data-no-swipe] controls are ignored.
 */

export const SWIPE_SLOP = 24;
export const SWIPE_LOCK_RATIO = 1.6;
export const SWIPE_ACTION_WIDTH = 80;
const OPEN_DISTANCE = SWIPE_ACTION_WIDTH * 0.55;
const MIN_FLICK_DISTANCE = SWIPE_ACTION_WIDTH * 0.3;
const FLICK_VELOCITY = 0.45; // px per ms
const OPEN_EVENT = "jf:swipe-reveal-open";

export type GestureMode = "pending" | "swipe" | "scroll";

/** Decide what a gesture is once it has moved (dx, dy) from its start. */
export function classifyGesture(dx: number, dy: number): GestureMode {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay > 10 && ay >= ax) return "scroll";
  if (ax >= SWIPE_SLOP) return ax >= SWIPE_LOCK_RATIO * ay ? "swipe" : "scroll";
  return "pending";
}

/** Card offset while dragging (negative = revealing the action on the right). */
export function dragOffset(baseOffset: number, dx: number): number {
  // Discount the slop so the card doesn't jump when the swipe locks in.
  const effective = dx < 0 ? Math.min(0, dx + SWIPE_SLOP) : Math.max(0, dx - SWIPE_SLOP);
  const raw = baseOffset + effective;
  if (raw > 0) return Math.min(12, raw * 0.2); // resist opening the wrong way
  if (raw < -SWIPE_ACTION_WIDTH) {
    const over = -raw - SWIPE_ACTION_WIDTH;
    return -(SWIPE_ACTION_WIDTH + Math.min(24, over * 0.25)); // rubber band
  }
  return raw;
}

/** Where the card settles on release. */
export function releaseOpen(offset: number, velocity: number): boolean {
  const pulled = -offset;
  if (pulled >= OPEN_DISTANCE) return velocity < FLICK_VELOCITY; // unless flicked back closed
  if (pulled >= MIN_FLICK_DISTANCE && velocity <= -FLICK_VELOCITY) return true;
  return false;
}

function ignoreTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable='true'], [data-no-swipe], [role='slider']");
}

export function SwipeToReveal({
  enabled,
  actionLabel,
  onAction,
  children,
}: {
  enabled: boolean;
  /** Accessible label, e.g. "Delete Lateral Raise from this workout". */
  actionLabel: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const open = offset <= -SWIPE_ACTION_WIDTH + 1 && !dragging;
  const g = useRef<{ x: number; y: number; base: number; mode: GestureMode; lastX: number; lastT: number; v: number; pointerId: number | null } | null>(null);
  // Swipes don't emit clicks on touch, so a boolean flag could swallow the
  // next real tap; suppress only clicks that land right after a gesture.
  const suppressClickUntil = useRef(0);

  const close = useCallback(() => setOffset(0), []);

  // Only one card open at a time.
  useEffect(() => {
    const onOther = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) close(); };
    window.addEventListener(OPEN_EVENT, onOther);
    return () => window.removeEventListener(OPEN_EVENT, onOther);
  }, [id, close]);

  // While open: tapping outside or scrolling closes it.
  useEffect(() => {
    if (offset === 0 || dragging) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [offset, dragging, close]);

  if (!enabled) return <>{children}</>;

  const begin = (x: number, y: number, target: EventTarget | null, pointerId: number | null) => {
    if (ignoreTarget(target)) {
      g.current = null;
      if (offset !== 0) close(); // interacting with the card's inputs closes it
      return;
    }
    g.current = { x, y, base: offset, mode: "pending", lastX: x, lastT: performance.now(), v: 0, pointerId };
  };
  const move = (x: number, y: number) => {
    const s = g.current;
    if (!s || s.mode === "scroll") return;
    const dx = x - s.x;
    const dy = y - s.y;
    if (s.mode === "pending") {
      s.mode = classifyGesture(dx, dy);
      if (s.mode === "scroll") { if (offset !== 0) close(); return; }
      if (s.mode !== "swipe") return;
      setDragging(true);
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    }
    const now = performance.now();
    const dt = Math.max(1, now - s.lastT);
    s.v = 0.7 * s.v + 0.3 * ((x - s.lastX) / dt);
    s.lastX = x;
    s.lastT = now;
    setOffset(dragOffset(s.base, dx));
  };
  const end = () => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    if (s.mode === "swipe") {
      suppressClickUntil.current = performance.now() + 400; // a swipe is never also a tap
      setDragging(false);
      setOffset((cur) => (releaseOpen(cur, s.v) ? -SWIPE_ACTION_WIDTH : 0));
    } else if (s.mode === "pending" && offset !== 0) {
      // A plain tap on an open card closes it instead of activating content.
      suppressClickUntil.current = performance.now() + 400;
      close();
    }
  };

  const reveal = Math.min(1, -offset / SWIPE_ACTION_WIDTH);

  return (
    <div ref={rootRef} className="relative overflow-hidden rounded-[1.35rem]" data-swipe-open={open ? "true" : undefined}>
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-center"
        style={{ width: SWIPE_ACTION_WIDTH, opacity: reveal, pointerEvents: open ? "auto" : "none" }}
        aria-hidden={!open}
      >
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          className="m-1.5 flex h-[calc(100%-0.75rem)] max-h-28 w-[calc(100%-0.75rem)] flex-col items-center justify-center gap-1 rounded-2xl bg-destructive text-xs font-bold text-destructive-foreground shadow-sm active:scale-95"
          aria-label={actionLabel}
          onClick={() => { setOffset(0); onAction(); }}
        >
          <Trash2 className="h-5 w-5" />
          Delete
        </button>
      </div>
      <div
        className={cn("relative bg-background touch-pan-y", !dragging && "transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]")}
        style={{ transform: `translate3d(${offset}px,0,0)` }}
        onTouchStart={(e) => begin(e.touches[0].clientX, e.touches[0].clientY, e.target, null)}
        onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={end}
        onTouchCancel={() => { g.current = null; setDragging(false); setOffset((cur) => (cur <= -SWIPE_ACTION_WIDTH + 1 ? cur : 0)); }}
        onPointerDown={(e) => { if (e.pointerType === "mouse") begin(e.clientX, e.clientY, e.target, e.pointerId); }}
        onPointerMove={(e) => { if (e.pointerType === "mouse" && g.current) move(e.clientX, e.clientY); }}
        onPointerUp={(e) => { if (e.pointerType === "mouse") end(); }}
        onClickCapture={(e) => {
          if (performance.now() < suppressClickUntil.current) {
            suppressClickUntil.current = 0;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
