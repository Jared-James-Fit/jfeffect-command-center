/**
 * Suppress iOS "Undo Typing" (shake-to-undo) prompts.
 *
 * iOS offers the prompt whenever the device is jolted and a text field still
 * has undo history — constant mid-workout. Web pages can't turn the gesture
 * off (the native app does via applicationSupportsShakeToEdit), but WebKit
 * drops a field's undo history when its value is set by script. So once the
 * user pauses typing or leaves a field, rewrite the value in place: nothing
 * visible changes, no React onChange fires, and there's nothing left to undo.
 *
 * Leaving the app is the other big trigger: iOS freezes the page the moment
 * the phone is locked or the app is switched, so the idle timer never fires
 * and no focusout happens. Picking the phone back up then reads as a shake
 * and the prompt appears on return. So we also flush every field (and end
 * the editing session) when the page is hidden, and again on the way back.
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

/** Clear undo history in every text field on the page. */
export function flushAllFields(root: ParentNode = document) {
  root.querySelectorAll<Field>("input, textarea").forEach((el) => {
    if (isTextField(el)) flushUndoHistory(el);
  });
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

  // Leaving the app (lock screen, app switcher, notification tap): finish the
  // editing session and wipe undo history everywhere before iOS suspends us.
  const onLeave = () => {
    const active = document.activeElement;
    if (isTextField(active)) {
      clear(active);
      active.blur();
    }
    flushAllFields();
  };
  // Coming back: flush again straight away in case anything slipped through
  // (e.g. a field typed into in the same instant the app was backgrounded).
  const onReturn = () => flushAllFields();
  const onVisibility = () => (document.visibilityState === "hidden" ? onLeave() : onReturn());

  document.addEventListener("input", onInput, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("blur", onLeave);
  window.addEventListener("pageshow", onReturn);
  window.addEventListener("focus", onReturn);
  return () => {
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onLeave);
    window.removeEventListener("blur", onLeave);
    window.removeEventListener("pageshow", onReturn);
    window.removeEventListener("focus", onReturn);
  };
}
