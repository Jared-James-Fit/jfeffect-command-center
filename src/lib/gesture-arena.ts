/**
 * Who a finger's drag belongs to, app-wide (Nov 26 2026). Two kinds of
 * gesture share every touch:
 *
 *  - parent gestures that move the screen: swipe right to go back
 *    (`SwipeBack`), pull down to refresh (`TabRefresh`), swipe a bottom sheet
 *    down (`useSwipeDownToClose`) and swipe the Crew feed into the camera
 *    (`useSwipeToCreate`);
 *  - things on the screen that a drag moves: the 3D body, a slider, a chart's
 *    scrub, a scrub bar, a story, a map, a drag handle.
 *
 * The rule, the same one native apps follow: the thing under the finger wins.
 * A parent gesture never starts on something that owns that direction
 * (`ownerOf`), never starts or carries on while something else holds the
 * finger (`claimGesture` / `gestureHolder`), and every hold ends when the last
 * finger lifts, a touch is cancelled, or the app goes to the background
 * (`onGestureReset`), so nothing is ever left mid-drag. The one exception is an
 * intentional back swipe from the left edge (`isBackEdge`), which wins over
 * whatever is under it wherever the edge is ours (the home-screen app, the
 * phone apps); in iPhone Safari's own tab the edge is the browser's Back and
 * the app leaves it alone.
 *
 * Something owns a direction when it says so (`data-gesture="x"`, `"y"` or
 * `"x y"`), when it's a slider, a range input, a chart or a scrub bar, or when
 * its CSS `touch-action` takes that direction away from the browser (an
 * element that is `touch-action: none` or `pan-y` handles horizontal drags
 * itself). A parent gesture that runs reads the same rule, so a new drag
 * surface only has to set its touch-action (or the attribute) to be safe.
 */

export type Axis = "x" | "y";

/** The left edge a back swipe can start from on purpose (iOS's own edge is about 20pt). */
export const BACK_EDGE_PX = 24;

/** Things that always handle their own drags, by direction. */
const BUILT_IN_OWNERS: Record<Axis, string> = {
  x: '[role="slider"],input[type="range"],.recharts-wrapper,[data-video-scrubber]',
  y: '[role="slider"],input[type="range"]',
};

/**
 * Does a `touch-action` value keep `axis` from the browser, i.e. does the
 * element handle drags that way itself? `none` keeps both, `pan-y` keeps
 * horizontal, `pan-x pan-y` / `manipulation` / `auto` keep nothing.
 */
export function touchActionOwns(value: string | null | undefined, axis: Axis): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v || v === "auto" || v === "manipulation") return false;
  if (v === "none") return true;
  const tokens = v.split(/\s+/);
  const lets = axis === "x" ? ["pan-x", "pan-left", "pan-right"] : ["pan-y", "pan-up", "pan-down"];
  return !tokens.some((t) => lets.includes(t));
}

/** What `data-gesture` says about an axis: true (owns it), false (says it doesn't), null (silent). */
export function attributeOwns(value: string | null | undefined, axis: Axis): boolean | null {
  if (value == null) return null;
  const tokens = value.trim().toLowerCase().split(/\s+/);
  if (tokens.includes(axis)) return true;
  return null;
}

/** The parts of an element `ownerOf` reads (a DOM element, or a stand-in in tests). */
export type OwnerNode = {
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  parentElement: OwnerNode | null;
};

/**
 * The nearest element from `target` up that owns drags in `axis`, or null.
 * Stops below `stop` (default: the body), so the page's own root never counts.
 * `touchAction` reads an element's computed touch-action (injected for tests).
 */
export function ownerOf(
  target: OwnerNode | null,
  axis: Axis,
  opts: { stop?: OwnerNode | null; touchAction?: (el: OwnerNode) => string | null } = {},
): OwnerNode | null {
  const read = opts.touchAction ?? domTouchAction;
  for (let n: OwnerNode | null = target; n; n = n.parentElement) {
    if (n === opts.stop) return null;
    const tag = (n as unknown as { tagName?: string }).tagName;
    if (tag === "BODY" || tag === "HTML") return null;
    if (attributeOwns(n.getAttribute("data-gesture"), axis)) return n;
    try {
      if (n.matches(BUILT_IN_OWNERS[axis])) return n;
    } catch {
      /* a stand-in without selector support */
    }
    if (touchActionOwns(read(n), axis)) return n;
  }
  return null;
}

function domTouchAction(el: OwnerNode): string | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  try {
    return window.getComputedStyle(el as unknown as Element).touchAction || null;
  } catch {
    return null;
  }
}

/** iPhone Safari's own tab: a swipe from the left edge is the browser's Back, never the app's. */
export function edgeBelongsToBrowser(nav: unknown = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  return !!nav && (nav as { standalone?: boolean }).standalone === false;
}

/** A touch that starts here is an intentional back swipe, ours to take over whatever is under it. */
export function isBackEdge(x: number, nav?: unknown): boolean {
  return x < BACK_EDGE_PX && !edgeBelongsToBrowser(nav);
}

/**
 * One arena: who holds the finger right now. Pure state with explicit inputs,
 * so the rules are testable; `arena` below is the app's, fed by the window.
 */
export function createGestureArena() {
  let holder: string | null = null;
  const fingers = new Set<number>();
  const resets = new Set<() => void>();
  const changes = new Set<(holder: string | null) => void>();
  const set = (next: string | null) => {
    if (next === holder) return;
    holder = next;
    for (const cb of changes) cb(holder);
  };
  return {
    /** Take the finger for `id`. False when something else already has it. */
    claim(id: string): boolean {
      if (holder && holder !== id) return false;
      set(id);
      return true;
    },
    /** Let go (only the holder can). */
    release(id: string) {
      if (holder === id) set(null);
    },
    holder: () => holder,
    /** Someone other than `id` holds the finger. */
    heldByOther: (id: string) => holder !== null && holder !== id,
    /** A finger landed (touch identifier or pointer id). */
    down(finger: number) {
      fingers.add(finger);
    },
    /** A finger lifted or was cancelled: once none are down, nobody holds anything. */
    up(finger: number) {
      fingers.delete(finger);
      if (!fingers.size) set(null);
    },
    /** Every finger gone at once (touchend with no touches left, the app hidden). */
    allUp() {
      fingers.clear();
      set(null);
    },
    /** The app went away mid-gesture: everyone puts things back. */
    reset() {
      fingers.clear();
      set(null);
      for (const cb of [...resets]) cb();
    },
    onReset(cb: () => void): () => void {
      resets.add(cb);
      return () => resets.delete(cb);
    },
    onChange(cb: (holder: string | null) => void): () => void {
      changes.add(cb);
      return () => changes.delete(cb);
    },
    fingersDown: () => fingers.size,
  };
}

export type GestureArena = ReturnType<typeof createGestureArena>;

/** The app's arena. */
export const arena = createGestureArena();

let watching = false;
/**
 * Feeds the arena from the window: fingers down and up (the hold is forgotten
 * once the last finger is up, whether or not the gesture let go itself), and
 * the app going away mid-gesture. Marks `<html data-gesture-held>` while held.
 */
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const later = (fn: () => void) => (typeof queueMicrotask === "function" ? queueMicrotask(fn) : Promise.resolve().then(fn));
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", (e) => arena.down(e.pointerId), opts);
  const pointerUp = (e: PointerEvent) => later(() => arena.up(e.pointerId));
  window.addEventListener("pointerup", pointerUp, opts);
  window.addEventListener("pointercancel", pointerUp, opts);
  const touchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) later(() => arena.allUp());
  };
  window.addEventListener("touchend", touchEnd, opts);
  window.addEventListener("touchcancel", touchEnd, opts);
  const away = () => arena.reset();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") away();
  });
  window.addEventListener("pagehide", away);
  window.addEventListener("blur", away);
  arena.onChange((h) => {
    const html = document.documentElement;
    if (h) html.setAttribute("data-gesture-held", h);
    else html.removeAttribute("data-gesture-held");
  });
}

// listening from the start, so the very first finger of a gesture is counted too
if (typeof window !== "undefined") watch();

/** Take the finger for `id` (false when something else has it). */
export function claimGesture(id: string): boolean {
  watch();
  return arena.claim(id);
}
export function releaseGesture(id: string) {
  arena.release(id);
}
export function gestureHolder(): string | null {
  return arena.holder();
}
export function heldByOther(id: string): boolean {
  return arena.heldByOther(id);
}
/** Called when the app goes away mid-gesture (hidden, blurred, page hidden): put things back. */
export function onGestureReset(cb: () => void): () => void {
  watch();
  return arena.onReset(cb);
}

/** Does something under `target` own drags in `axis`? (A parent gesture asks before it starts.) */
export function targetOwns(target: EventTarget | null, axis: Axis, stop?: Element | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return !!ownerOf(target as unknown as OwnerNode, axis, { stop: (stop ?? null) as unknown as OwnerNode | null });
}
