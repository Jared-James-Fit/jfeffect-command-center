import { useEffect, type RefObject } from "react";

/**
 * HTML5 drag and drop on a touch screen, only where it's used (the program
 * template editor's exercise library, dragged into a day on an iPad), never
 * across the whole app (Nov 23 2026).
 *
 * The drag-drop-touch polyfill is a plain script that listens on `document`
 * for touchstart and touchmove with passive: false. Loaded app-wide from the
 * root, that made every touch in the app (every swipe through Crew's feed
 * and its carousels) wait on the page's main thread before the browser could
 * scroll: on a busy phone a swipe was answered late or not at all. Here the
 * script runs against a stand-in `document` that hands its touch listeners
 * over, and they go on the editor's own box while it's mounted and come off
 * when it goes; everything else it does reaches the real document.
 */
type Held = [
  type: string,
  fn: EventListenerOrEventListenerObject,
  opts?: boolean | AddEventListenerOptions,
];

let loading: Promise<Held[]> | null = null;

function loadPolyfill(): Promise<Held[]> {
  return (loading ??= import("drag-drop-touch/DragDropTouch.js?raw").then(({ default: source }) => {
    const held: Held[] = [];
    const doc = new Proxy(document, {
      get(target, key) {
        if (key === "addEventListener")
          return (
            type: string,
            fn: EventListenerOrEventListenerObject,
            opts?: boolean | AddEventListenerOptions,
          ) => {
            if (type.startsWith("touch")) held.push([type, fn, opts]);
            else target.addEventListener(type, fn, opts);
          };
        const v = Reflect.get(target, key, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    // the polyfill builds its one instance as it runs: with this `document`, its touch listeners are ours to place
    new Function("document", source)(doc);
    return held;
  }));
}

/** Drag and drop by touch inside `ref`'s element while `on` (a touch screen only; a mouse needs nothing). */
export function useDragDropTouch(ref: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    if (!on || typeof document === "undefined" || !("ontouchstart" in document)) return;
    let alive = true;
    let el: HTMLElement | null = null;
    let held: Held[] = [];
    loadPolyfill()
      .then((h) => {
        if (!alive || !ref.current) return;
        el = ref.current;
        held = h;
        for (const [type, fn, opts] of held) el.addEventListener(type, fn, opts);
      })
      .catch(() => {
        /* dragging by touch is a convenience: the + on each exercise still adds it */
      });
    return () => {
      alive = false;
      if (el) for (const [type, fn, opts] of held) el.removeEventListener(type, fn, opts);
    };
  }, [ref, on]);
}
