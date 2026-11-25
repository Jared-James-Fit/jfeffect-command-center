// Is anything on screen in progress right now, so a reload could lose it? Read from the page and
// the app's own queues, only when a newer build is waiting (use-app-freshness.ts). Client only.

import { getQueueSnapshot } from "@/lib/workout-offline-queue";

/** True while something could be lost by reloading the page now. */
export async function hasUnsavedWork(): Promise<boolean> {
  // 1. Workout writes still waiting to sync.
  try {
    if (getQueueSnapshot().length > 0) return true;
  } catch {
    /* queue not available in this context */
  }
  // 2. A set video still sending to the coach.
  try {
    const { getSetVideoJobs, isActiveJob } = await import("@/lib/set-videos/jobs");
    if (getSetVideoJobs().some(isActiveJob)) return true;
  } catch {
    /* not loaded: nothing sending */
  }
  if (typeof document === "undefined") return false;
  return pageIsBusy(document);
}

/** The page itself: something open, being typed, or marked unsaved. */
export function pageIsBusy(doc: Document): boolean {
  // A screen that says it has unsaved changes.
  if (doc.querySelector('[data-unsaved="true"]')) return true;
  // The camera or a recording is up.
  const html = doc.documentElement;
  if (html.hasAttribute("data-camera-open") || html.hasAttribute("data-clip-held")) return true;
  // A sheet, dialog or menu is open (closed ones carry data-state="closed" or aren't in the page).
  const open = doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]');
  for (const el of open) {
    if (el.getAttribute("data-state") === "closed" || el.closest("[hidden]")) continue;
    return true;
  }
  // Someone is typing.
  const active = doc.activeElement as HTMLElement | null;
  if (active && active !== doc.body && (isTextField(active) || active.isContentEditable))
    return true;
  // Something half written: a message, comment or note not sent yet.
  for (const t of doc.querySelectorAll<HTMLTextAreaElement>("textarea")) {
    if (!t.readOnly && !t.disabled && t.value.trim()) return true;
  }
  for (const el of doc.querySelectorAll<HTMLElement>('[contenteditable="true"]')) {
    if ((el.textContent ?? "").trim()) return true;
  }
  return false;
}

function isTextField(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return ![
    "button",
    "checkbox",
    "radio",
    "range",
    "submit",
    "reset",
    "color",
    "file",
    "hidden",
    "image",
  ].includes(type);
}
