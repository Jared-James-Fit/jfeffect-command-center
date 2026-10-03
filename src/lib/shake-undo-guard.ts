/**
 * Suppress iOS "Undo Typing" (shake-to-undo) prompts.
 *
 * iOS offers the prompt whenever the device is jolted and a text field still
 * has undo history — constant mid-workout. Web pages can't turn the gesture
 * off (the native app does via applicationSupportsShakeToEdit), but WebKit
 * drops a field's undo history when its value is set by script. So once the
 * user pauses typing or leaves a field, rewrite the value in place: nothing
 * visible changes, no React onChange fires, and there's nothing left to undo.
 */

const IDLE_MS = 900;
const TEXT_TYPES = new Set(["", "text", "number", "search", "tel", "url", "email", "password"]);

type Field = HTMLInputElement | HTMLTextAreaElement;

function isTextField(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type);
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Clear a field's undo history without changing what the user sees. */
export function flushUndoHistory(el: Field) {
  const value = el.value;
  if (!value) return;
  let start: number | null = null;
  let end: number | null = null;
  const focused = document.activeElement === el;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    // type=number has no selection API; caret stays at the end, where typing goes anyway.
  }
  el.value = "";
  el.value = value;
  if (focused && start != null && end != null) {
    try {
      el.setSelectionRange(start, end);
    } catch {}
  }
}

export function installShakeUndoGuard(): () => void {
  if (typeof window === "undefined" || !isIOS()) return () => {};

  const timers = new WeakMap<Field, number>();
  const clear = (el: Field) => {
    const t = timers.get(el);
    if (t) window.clearTimeout(t);
    timers.delete(el);
  };

  const onInput = (e: Event) => {
    const el = e.target;
    if (!isTextField(el) || (e as InputEvent).isComposing) return;
    clear(el);
    timers.set(el, window.setTimeout(() => flushUndoHistory(el), IDLE_MS));
  };
  const onFocusOut = (e: Event) => {
    const el = e.target;
    if (!isTextField(el)) return;
    clear(el);
    flushUndoHistory(el);
  };

  document.addEventListener("input", onInput, true);
  document.addEventListener("focusout", onFocusOut, true);
  return () => {
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("focusout", onFocusOut, true);
  };
}
