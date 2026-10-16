/**
 * Asks the app shell to open its More drawer (every page, every account). For
 * pages that draw their own top bar, like Crew, where the shell's ☰ isn't on
 * screen: your Crew profile has it at the top right, Instagram's spot.
 */
export const OPEN_MORE_EVENT = "app:open-more";

export function openAppMore() {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_MORE_EVENT));
  } catch {
    /* no window (server render) */
  }
}

/** The pages that draw their own phone top bar instead of the shell's (logo, title, ☰). */
export function pageOwnsTopBar(pathname: string, pages: readonly string[] | undefined): boolean {
  return !!pages?.some((p) => pathname === p || pathname === `${p}/`);
}
