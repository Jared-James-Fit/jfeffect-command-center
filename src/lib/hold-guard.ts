/**
 * Hold-to-open menus (messages, chats) vs iOS's own long-press.
 *
 * Ours fires at ~450ms and opens a sheet; iOS's text-selection long-press
 * fires a moment later. By then the finger is over the sheet's backdrop,
 * which has no text, so iOS selected the whole page: a blue tint over the
 * screen and the selection's edge bars down both sides.
 *
 * From the moment a finger goes down on something holdable until it lifts,
 * nothing on the page can be selected (and no callout opens); any selection
 * that slipped through is cleared as the finger lifts. Scrolling, taps and
 * typing are untouched: it only lasts for the press.
 */
let active = false;

function clearSelection() {
  try {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.removeAllRanges();
  } catch {
    /* nothing to clear */
  }
}

export function guardNativeHold() {
  if (typeof document === "undefined" || active) return;
  active = true;
  const root = document.documentElement;
  root.setAttribute("data-holding", "");
  clearSelection();
  const events = ["touchend", "touchcancel", "pointerup", "pointercancel"] as const;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    for (const ev of events) window.removeEventListener(ev, end, true);
    clearSelection();
    // iOS can apply its selection just after the finger lifts.
    window.setTimeout(() => {
      clearSelection();
      root.removeAttribute("data-holding");
      active = false;
    }, 300);
  };
  for (const ev of events) window.addEventListener(ev, end, true);
  // Never leave the page unselectable if an end event goes missing.
  window.setTimeout(end, 8000);
}
