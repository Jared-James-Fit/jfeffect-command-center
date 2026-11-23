/**
 * Focus mode for the program editor (Nov 23 2026): the editor alone on the
 * screen. It's a way of showing the same page, never a second editor: the
 * admin's sidebar, the phone's app bar and tab bar and the parts of the page
 * the coach opens now and then (`data-focus-hide`) step aside through one
 * attribute on <html> (`data-builder-focus`, styles.css), so nothing in the
 * editor remounts and whatever is being typed, opened or undone stays where
 * it is. One tap on the header's Focus button, F, or Esc to leave; the choice
 * is remembered on the device, so a coach who works in it opens in it.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEY = "jf.builder-focus";
const listeners = new Set<() => void>();

let on = (() => {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
})();

function emit() { listeners.forEach((l) => l()); }

export function builderFocusOn(): boolean { return on; }

export function setBuilderFocus(next: boolean) {
  if (next === on) return;
  on = next;
  try { window.localStorage.setItem(KEY, next ? "1" : "0"); } catch {}
  emit();
}

export function toggleBuilderFocus() { setBuilderFocus(!on); }

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useBuilderFocus(): boolean {
  return useSyncExternalStore(subscribe, () => on, () => false);
}

/** A key the editor may take: nobody typing, no menu, sheet or dialog up. */
export function builderKeyFree(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  if (t) {
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return false;
    if (t.closest?.('[role="dialog"],[role="menu"],[role="listbox"],[data-sheet-cell],[data-radix-popper-content-wrapper]')) return false;
  }
  if (typeof document !== "undefined" && document.querySelector('[role="dialog"][data-state="open"],[role="menu"][data-state="open"],[role="alertdialog"][data-state="open"]')) return false;
  return true;
}

/**
 * Mounted once by the editor page: sets the attribute while the editor is on
 * screen and focus is on (taken off again when the editor goes, so the rest of
 * the admin never loses its menu), and listens for F and Esc.
 */
export function BuilderFocusHost() {
  const focus = useBuilderFocus();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    if (focus) html.setAttribute("data-builder-focus", "");
    else html.removeAttribute("data-builder-focus");
    return () => html.removeAttribute("data-builder-focus");
  }, [focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.shiftKey) return;
      if (e.key === "Escape") {
        if (!on || !builderKeyFree(e)) return;
        e.preventDefault();
        setBuilderFocus(false);
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (!builderKeyFree(e)) return;
        e.preventDefault();
        toggleBuilderFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/** The header's way in and out: an icon on a phone, the word on a computer. */
export function BuilderFocusButton({ className, phone }: { className?: string; phone?: boolean }) {
  const focus = useBuilderFocus();
  const label = focus ? "Exit focus mode" : "Focus mode";
  return (
    <Button
      type="button"
      variant="ghost"
      size={phone ? "icon" : "sm"}
      onClick={() => toggleBuilderFocus()}
      aria-pressed={focus}
      aria-label={label}
      title={`${label} (F${focus ? " or Esc" : ""})`}
      data-builder-focus-toggle
      className={cn(phone ? "h-10 w-10" : "h-8 gap-1.5 px-2 text-xs font-medium", focus && !phone && "bg-secondary", className)}
    >
      {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      {phone ? null : <span>{focus ? "Exit focus" : "Focus"}</span>}
    </Button>
  );
}
