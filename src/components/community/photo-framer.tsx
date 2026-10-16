import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  clampFraming,
  gridWindow,
  panFocus,
  panFraming,
  pinchFraming,
  placement,
  snapFocus,
  snapToCentre,
  focusPosition,
  type Framing,
  type MediaFocus,
  type Point,
  type Size,
} from "@/lib/photo-frame";

const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* no haptics here */
  }
};

type GestureHandlers = {
  /** A gesture started (the grid shows). */
  onStart: () => void;
  /** It ended (the grid fades). */
  onEnd: () => void;
  onPan: (dx: number, dy: number) => void;
  /** Two fingers landed: remember where things were. */
  onPinchStart: () => void;
  /** Midpoints and spreads in frame px, at the pinch's start and now. */
  onPinch: (m0: Point, d0: number, m: Point, d: number) => void;
};

/**
 * Pointer handling for a frame: one finger drags (when `oneFinger`), two
 * pinch. With `oneFinger` off a single finger is left alone, so the screen
 * under it can still take a swipe (a card's looks); a second finger claims
 * the gesture and `onClaim` tells the screen to drop its swipe.
 */
function useFrameGestures({ enabled, oneFinger, onClaim, ...h }: GestureHandlers & { enabled: boolean; oneFinger: boolean; onClaim?: () => void }) {
  const st = useRef<{ pts: Map<number, Point>; mode: "idle" | "pan" | "pinch" | "hold"; last: Point | null; m0: Point; d0: number; claimed: boolean; started: boolean; box: DOMRect | null }>({
    pts: new Map(),
    mode: "idle",
    last: null,
    m0: { x: 0, y: 0 },
    d0: 1,
    claimed: false,
    started: false,
    box: null,
  });
  const hr = useRef(h);
  hr.current = h;
  const at = (e: React.PointerEvent): Point => {
    const b = st.current.box ?? (e.currentTarget as Element).getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const two = () => {
    const [a, b] = [...st.current.pts.values()];
    return { m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(b.x - a.x, b.y - a.y) || 1 };
  };
  const claim = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    if (!st.current.claimed) {
      st.current.claimed = true;
      onClaim?.();
    }
  };
  const start = () => {
    if (st.current.started) return;
    st.current.started = true;
    hr.current.onStart();
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    if ((e.target as Element).closest("button, input, textarea, [data-no-frame]")) return;
    const s = st.current;
    if (!s.pts.size) s.box = (e.currentTarget as Element).getBoundingClientRect();
    s.pts.set(e.pointerId, at(e));
    if (s.pts.size === 1) {
      if (oneFinger) {
        claim(e);
        s.mode = "pan";
        s.last = at(e);
        start();
      } else s.mode = "idle";
    } else if (s.pts.size === 2) {
      claim(e);
      // the first finger's own capture: everything from here is ours
      s.mode = "pinch";
      const t = two();
      s.m0 = t.m;
      s.d0 = t.d;
      hr.current.onPinchStart();
      start();
    } else claim(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.pts.has(e.pointerId)) return;
    if (s.claimed) e.stopPropagation();
    const p = at(e);
    s.pts.set(e.pointerId, p);
    if (s.mode === "pan" && s.last) {
      hr.current.onPan(p.x - s.last.x, p.y - s.last.y);
      s.last = p;
    } else if (s.mode === "pinch" && s.pts.size >= 2) {
      const t = two();
      hr.current.onPinch(s.m0, s.d0, t.m, t.d);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.pts.has(e.pointerId)) return;
    if (s.claimed) e.stopPropagation();
    s.pts.delete(e.pointerId);
    if (s.pts.size === 1 && s.mode === "pinch") {
      // one finger still down: it carries on dragging (or holds, with one-finger dragging off)
      const [p] = [...s.pts.values()];
      s.mode = oneFinger ? "pan" : "hold";
      s.last = p;
      return;
    }
    if (s.pts.size === 0) {
      s.mode = "idle";
      s.last = null;
      s.claimed = false;
      s.box = null;
      if (s.started) {
        s.started = false;
        hr.current.onEnd();
      }
    }
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/**
 * The help lines while something is being framed: a rule-of-thirds grid
 * (only while a finger is on it, like Instagram's), the centre lines in
 * yellow when it snaps dead centre, and the profile grid's 3:4 tile.
 */
export function FrameGuides({ active, snapV, snapH, aspect, gridPreview }: { active: boolean; snapV: boolean; snapH: boolean; aspect: number; gridPreview: boolean }) {
  const win = gridWindow(aspect);
  const line = "absolute bg-white/60 shadow-[0_0_1px_rgba(0,0,0,0.6)]";
  // only worth drawing when the tile actually leaves something out
  const showWin = gridPreview && (win.w < 0.995 || win.h < 0.995);
  return (
    <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-200", active ? "opacity-100" : "opacity-0")} aria-hidden data-frame-guides={active ? "on" : "off"}>
      <div className={cn(line, "inset-y-0 left-1/3 w-px")} />
      <div className={cn(line, "inset-y-0 left-2/3 w-px")} />
      <div className={cn(line, "inset-x-0 top-1/3 h-px")} />
      <div className={cn(line, "inset-x-0 top-2/3 h-px")} />
      {snapV && <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#ffd400]" data-snap="v" />}
      {snapH && <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#ffd400]" data-snap="h" />}
      {showWin && (
        <div
          className="absolute rounded-[3px] border border-dashed border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
          style={{ left: `${win.x * 100}%`, top: `${win.y * 100}%`, width: `${win.w * 100}%`, height: `${win.h * 100}%` }}
          data-grid-window
        >
          <span className="absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-1.5 py-px text-[10px] font-bold text-white backdrop-blur-sm">Profile grid</span>
        </div>
      )}
    </div>
  );
}

/**
 * A photo in its post's frame: drag it, pinch it, never smaller than the
 * frame. `framing` is the parent's (it's what gets baked into the post).
 * With a card on top (`showImage` off) it still takes the gestures and the
 * card repaints from `framing`.
 */
export function PhotoFramer({
  src,
  size,
  frame,
  framing,
  onFraming,
  oneFinger,
  showImage = true,
  gridPreview = false,
  flash = 0,
  onActive,
  onClaim,
}: {
  src: string | null;
  /** The photo's own size (px). */
  size: Size;
  /** The frame on screen (px). */
  frame: Size;
  framing: Framing;
  onFraming: (f: Framing) => void;
  oneFinger: boolean;
  showImage?: boolean;
  gridPreview?: boolean;
  /** Bump to show the grid for a moment (the shape just changed). */
  flash?: number;
  onActive?: (on: boolean) => void;
  onClaim?: () => void;
}) {
  const [active, setActive] = useState(false);
  const [snap, setSnap] = useState({ v: false, h: false });
  const raw = useRef(framing);
  const pinch0 = useRef(framing);
  const live = useRef(framing);
  live.current = framing;
  const snapRef = useRef(snap);
  const show = useCallback(
    (next: Framing) => {
      const s = snapToCentre(next, size, frame);
      if ((s.v && !snapRef.current.v) || (s.h && !snapRef.current.h)) buzz();
      if (s.v !== snapRef.current.v || s.h !== snapRef.current.h) {
        snapRef.current = { v: s.v, h: s.h };
        setSnap(snapRef.current);
      }
      onFraming(s.framing);
    },
    [size, frame, onFraming],
  );
  const g = useFrameGestures({
    enabled: frame.w > 0 && size.w > 0,
    oneFinger,
    onClaim,
    onStart: () => {
      raw.current = live.current;
      setActive(true);
      onActive?.(true);
    },
    onEnd: () => {
      setActive(false);
      snapRef.current = { v: false, h: false };
      setSnap(snapRef.current);
      onActive?.(false);
    },
    onPan: (dx, dy) => {
      raw.current = panFraming(raw.current, dx, dy, size, frame);
      show(raw.current);
    },
    onPinchStart: () => {
      pinch0.current = raw.current;
    },
    onPinch: (m0, d0, m, d) => {
      raw.current = pinchFraming(pinch0.current, m0, d0, m, d, size, frame);
      show(raw.current);
    },
  });
  // the shape changed: show the grid for a moment
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 700);
    return () => clearTimeout(t);
  }, [flash]);
  const f = clampFraming(framing, size, frame);
  const p = placement(f, size, frame);
  return (
    <div className="absolute inset-0 touch-none select-none overflow-hidden" {...g} data-photo-framer>
      {showImage && src && (
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
          style={{ width: p.w, height: p.h, transform: `translate3d(${p.x}px, ${p.y}px, 0)` }}
          data-framed-photo
        />
      )}
      <FrameGuides active={active || flashing} snapV={snap.v} snapH={snap.h} aspect={frame.w / (frame.h || 1)} gridPreview={gridPreview} />
    </div>
  );
}

/**
 * A clip (or any picture that's posted whole) in a frame that crops it:
 * drag to choose which part shows (its focus). `children` is the picture
 * itself; it gets the focus as its object-position from the parent.
 */
export function FocusFramer({
  size,
  frame,
  focus,
  onFocus,
  gridPreview = false,
  children,
}: {
  size: Size;
  frame: Size;
  focus: MediaFocus;
  onFocus: (f: MediaFocus) => void;
  gridPreview?: boolean;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [snap, setSnap] = useState({ v: false, h: false });
  const raw = useRef(focus);
  const live = useRef(focus);
  live.current = focus;
  const last = useRef<Point | null>(null);
  const move = (dx: number, dy: number) => {
    raw.current = panFocus(raw.current, dx, dy, size, frame);
    const s = snapFocus(raw.current, size, frame);
    if ((s.v && !snap.v) || (s.h && !snap.h)) buzz();
    if (s.v !== snap.v || s.h !== snap.h) setSnap({ v: s.v, h: s.h });
    onFocus(s.focus);
  };
  const g = useFrameGestures({
    enabled: frame.w > 0 && size.w > 0,
    oneFinger: true,
    onStart: () => {
      raw.current = live.current;
      setActive(true);
    },
    onEnd: () => {
      setActive(false);
      setSnap({ v: false, h: false });
      last.current = null;
    },
    onPan: move,
    onPinchStart: () => {
      last.current = null;
    },
    // two fingers just move it (a clip can't be zoomed)
    onPinch: (_m0, _d0, m) => {
      if (last.current) move(m.x - last.current.x, m.y - last.current.y);
      last.current = m;
    },
  });
  return (
    <div className="absolute inset-0 touch-none select-none overflow-hidden" {...g} data-focus-framer data-focus={focusPosition(focus) ?? "50% 50%"}>
      {children}
      <FrameGuides active={active} snapV={snap.v} snapH={snap.h} aspect={frame.w / (frame.h || 1)} gridPreview={gridPreview} />
    </div>
  );
}
