import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { phoneLayoutNow } from "@/lib/portrait-only";
import { revealDelta } from "@/lib/equipment/setup-draft";

/**
 * Typing a set's number on a phone (Nov 21 2026): a slim bar right above the
 * keyboard says which box it is ("Set 2 · RPE"), with ‹ › to the box before or
 * after it in the same card (warm-ups, then each set's boxes in the order
 * they're shown) and Done. Moving on saves the box exactly like leaving it and
 * opens the next one inside the same tap, so the number pad stays up: an
 * iPhone's own ‹ › can't, since only the box being typed in is a text box.
 * The row being typed in is kept clear of the keyboard and this bar.
 */

const BAR_PX = 48;

/** "Set 2 weight in lb — weight in lb" → "Set 2 · Weight in lb"; "Warm-up RPE (optional)" → "Warm-up · RPE (optional)". */
export function boxLabel(aria: string | null | undefined): string {
  const head = String(aria ?? "").split(" — ")[0].trim();
  const m = head.match(/^(Set \d+|Warm-up)\s+(.*)$/);
  if (!m) return head;
  const what = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return `${m[1]} · ${what}`;
}

/** The box `dir` steps from `current` in `boxes` (reading order), or null at either end. */
export function boxStep<T>(boxes: readonly T[], current: T, dir: 1 | -1): T | null {
  const i = boxes.indexOf(current);
  if (i < 0) return null;
  return boxes[i + dir] ?? null;
}

function boxesBeside(el: HTMLElement): HTMLElement[] {
  const card = el.closest("[data-workout-exercise]");
  if (!card) return [];
  return [...card.querySelectorAll<HTMLElement>("[data-set-box]")].filter(
    (b) => b === el || (!(b as HTMLButtonElement).disabled && b.getClientRects().length > 0),
  );
}

function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

const typingBox = (): HTMLInputElement | null => {
  const a = typeof document === "undefined" ? null : document.activeElement;
  return a instanceof HTMLInputElement && a.matches("[data-set-box]") && !!a.closest("[data-workout-exercise]") ? a : null;
};

export function SetKeyboardBar() {
  const [active, setActive] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    let t = 0;
    const read = () => {
      window.clearTimeout(t);
      // focus moves box to box inside one tap: look once it has landed
      t = window.setTimeout(() => setActive(phoneLayoutNow() ? typingBox() : null), 0);
    };
    document.addEventListener("focusin", read);
    document.addEventListener("focusout", read);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("focusin", read);
      document.removeEventListener("focusout", read);
    };
  }, []);
  const box = useVisualViewportBox(!!active);

  // Keep the row being typed in clear of the keyboard and this bar (and of the
  // top of the screen), once the keyboard has settled.
  useEffect(() => {
    if (!active || !box) return;
    const id = window.setTimeout(() => {
      if (!active.isConnected) return;
      const row = (active.closest("[data-set-row], [data-warmup-line]") as HTMLElement | null) ?? active;
      const r = row.getBoundingClientRect();
      const delta = revealDelta({ top: r.top, bottom: r.bottom, viewTop: box.top, viewBottom: box.top + box.height - BAR_PX, margin: 12 });
      if (!delta) return;
      const sc = scroller(row);
      if (sc) sc.scrollTop += delta;
      else window.scrollBy({ top: delta, behavior: "instant" as ScrollBehavior });
    }, 80);
    return () => window.clearTimeout(id);
  }, [active, box?.top, box?.height]);

  if (!active || !box) return null;
  const boxes = boxesBeside(active);
  const prev = boxStep(boxes, active as HTMLElement, -1);
  const next = boxStep(boxes, active as HTMLElement, 1);
  const go = (target: HTMLElement | null) => {
    if (!target) return;
    // saves it exactly like leaving the box, drawn now so a question it raises is on screen
    flushSync(() => active.blur());
    // a question about what was typed (a weight over the cap) comes first
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
    if (target instanceof HTMLInputElement) target.focus();
    else target.click();
  };
  // a tap on the bar never takes the focus (the keyboard stays up)
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const btn = "grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground transition active:scale-95 disabled:opacity-30";
  return (
    <div
      className="phone-column fixed inset-x-0 z-[60] flex items-center gap-0.5 border-t border-border/60 bg-background px-2"
      style={{ top: box.top + box.height - BAR_PX, height: BAR_PX }}
      data-set-keyboard-bar
    >
      <span className="min-w-0 flex-1 truncate pl-2 text-[14px] text-muted-foreground" data-set-keyboard-label>{boxLabel(active.getAttribute("aria-label"))}</span>
      <button type="button" className={btn} onPointerDown={keep} onMouseDown={keep} onClick={() => go(prev)} disabled={!prev} aria-label="Previous box" data-set-keyboard-prev>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button type="button" className={btn} onPointerDown={keep} onMouseDown={keep} onClick={() => go(next)} disabled={!next} aria-label="Next box" data-set-keyboard-next>
        <ChevronRight className="h-5 w-5" />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={() => active.blur()}
        className="ml-1 h-9 shrink-0 rounded-full bg-secondary px-4 text-[15px] font-semibold text-foreground transition active:scale-95"
        data-set-keyboard-done
      >
        Done
      </button>
    </div>
  );
}
