/**
 * Focus Mode for the coach's program builder (Nov 23 2026): the builder as its
 * own workspace. The admin sidebar, the phone's bars and floating pills step
 * aside (styles.css, `html[data-builder-focus]`); the builder's header and
 * toolbar stay, so nothing it does is hidden. No browser full screen (no
 * permission prompt): an immersive layout inside the app.
 *
 * One switch for the whole builder (the header's button, the toolbar's ⋯,
 * ⌘⇧.), remembered on this device: a coach who programs in Focus Mode opens
 * the next program in it. The page's look changes only while a builder is on
 * screen (`useBuilderFocusOnPage`); every other page keeps its sidebar. Esc
 * leaves it when nothing else (a dialog, a menu, a field) wants the key.
 */
import { useEffect, useSyncExternalStore } from "react";

const KEY = "jf.builder.focus";
const subs = new Set<() => void>();

function read(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = read();

export function setBuilderFocus(next: boolean | ((prev: boolean) => boolean)) {
  const v = typeof next === "function" ? next(on) : next;
  if (v === on) return;
  on = v;
  try {
    window.localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* private mode: it lasts the visit */
  }
  subs.forEach((fn) => fn());
}

export function useBuilderFocus(): [boolean, typeof setBuilderFocus] {
  const v = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    () => on,
    () => false,
  );
  return [v, setBuilderFocus];
}

/** Something else on screen wants Esc: an open dialog, sheet or menu, or a box being typed in. */
export function escapeBelongsElsewhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return true;
  if (typeof document === "undefined") return false;
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]');
}

/** The builder on screen: the page takes Focus Mode's look while it's on, Esc and ⌘⇧. switch it. */
export function useBuilderFocusOnPage() {
  const [focus] = useBuilderFocus();
  useEffect(() => {
    const root = document.documentElement;
    if (focus) root.setAttribute("data-builder-focus", "");
    else root.removeAttribute("data-builder-focus");
    return () => root.removeAttribute("data-builder-focus");
  }, [focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "." || e.key === ">")) {
        e.preventDefault();
        setBuilderFocus((v) => !v);
        return;
      }
      if (e.key === "Escape" && on && !escapeBelongsElsewhere(e)) {
        e.preventDefault();
        setBuilderFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
