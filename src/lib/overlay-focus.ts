/**
 * Where focus lands when a sheet or dialog opens.
 *
 * Radix focuses the first focusable element, which is almost always a Back /
 * close button. iOS Safari paints a focus ring on that programmatic focus, so
 * every sheet opened by a tap showed a ring around Back. Focus the sheet
 * itself instead: still inside the dialog for screen readers and keyboards
 * (Tab reaches Back next). A sheet that opens on a field (search, amount)
 * keeps that field's autofocus.
 */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusOverlayOnOpen(e: Event, userHandler?: (e: Event) => void) {
  userHandler?.(e);
  if (e.defaultPrevented) return;
  const container = e.target as HTMLElement | null;
  if (!container || typeof container.querySelector !== "function") return;
  const first = container.querySelector<HTMLElement>(FOCUSABLE);
  if (first && /^(INPUT|TEXTAREA|SELECT)$/.test(first.tagName)) return;
  e.preventDefault();
  container.focus({ preventScroll: true });
}
