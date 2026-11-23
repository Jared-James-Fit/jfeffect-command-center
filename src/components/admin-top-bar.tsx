import { KeyboardShortcutsHost } from "@/components/keyboard-shortcuts";

/**
 * Staff pages' global keyboard help (Nov 23 2026). The desktop strip that held
 * a keyboard icon and "View as client" above every admin page is gone: it cost
 * every page a row for two things already reachable without it.
 *
 *   - Keyboard shortcuts: "?" anywhere, or the command palette's "Keyboard
 *     shortcuts" (⌘K).
 *   - View as client: the command palette's "View as client…" (the same picker),
 *     the Clients list's Client view, a client's profile and their chat's ⋯.
 *
 * Search is the sidebar's "Search everything…" (⌘K), the one search on desktop.
 */
export function AdminTopBar() {
  return <KeyboardShortcutsHost />;
}
