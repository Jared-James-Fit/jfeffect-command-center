import { useRouterState } from "@tanstack/react-router";
import { Eye, Search } from "lucide-react";
import { KeyboardShortcutsButton } from "@/components/keyboard-shortcuts";
import { useAuth } from "@/lib/auth";

/**
 * Slim desktop strip above admin and coach pages: search, keyboard shortcuts
 * and "View as client". There is no Coaching / Membership switch any more:
 * membership is a section of the one admin menu, and member, client and team
 * accounts are all opened (and viewed as) from the Clients page.
 *
 * On phones the header already has search and More, so the strip stays out
 * of the way; it is still mounted because it hosts the "?" shortcut listener.
 */
export function AdminTopBar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as { tab?: string } | undefined });
  const { role, viewOnly } = useAuth();
  const canClientPov = (role === "admin" || role === "coach") && !viewOnly;

  // The chat is full-bleed; the strip would eat room above its header.
  const isChatRoute =
    pathname.startsWith("/admin/messages") ||
    (pathname.startsWith("/admin/communication") && (search?.tab ?? "messages") === "messages");
  if (isChatRoute) return null;

  return (
    <div className="sticky top-0 z-40 hidden items-center justify-end gap-2 border-b border-border bg-background/90 px-6 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:flex">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Open global search"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[9px] text-muted-foreground">⌘K</kbd>
      </button>
      <KeyboardShortcutsButton />
      {canClientPov && (
        <button
          type="button"
          onClick={() => {
            try { window.dispatchEvent(new CustomEvent("open-client-pov-picker")); } catch {}
          }}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-warning hover:bg-warning/10"
          aria-label="View as client"
          title="View as client"
        >
          <Eye className="h-3.5 w-3.5" /> View as client
        </button>
      )}
    </div>
  );
}
