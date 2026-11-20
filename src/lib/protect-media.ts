/**
 * Public pages don't hand out their photos: no right-click / long-press
 * "Save image", no "Open image in new tab", no dragging a photo to the
 * desktop (SalesPageShell, `data-protect-media`, plus the CSS rule of the same
 * name in styles.css, which turns off iOS's long-press menu). Text keeps its
 * own menu, so copying words still works. A screenshot still works; nothing a
 * page does can stop one.
 */
import type { SyntheticEvent } from "react";

export const PROTECTED_MEDIA = "img, picture, video, canvas, svg image";

/** True when the event started on a photo or video. */
export function onProtectedMedia(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el && typeof el.closest === "function" && !!el.closest(PROTECTED_MEDIA);
}

/** contextmenu / dragstart: refused on a photo, left alone anywhere else. */
export function blockMediaSave(e: SyntheticEvent) {
  if (onProtectedMedia(e.target)) e.preventDefault();
}
