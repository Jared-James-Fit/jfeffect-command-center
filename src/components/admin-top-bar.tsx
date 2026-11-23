import { KeyboardShortcutsHost } from "@/components/keyboard-shortcuts";

/**
 * There is no strip above admin pages any more (Nov 23 2026): "View as client"
 * lives on each client (Clients, a client's header and ⋯, ⌘⇧M, the palette),
 * and the keyboard-shortcuts list opens with `?` or the ⌘K palette's Help row,
 * so every admin page starts with its own content. This only hosts the `?`
 * listener and the list.
 */
export function AdminTopBar() {
  return <KeyboardShortcutsHost />;
}
