import { useRouterState } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { KeyboardShortcutsButton } from "@/components/keyboard-shortcuts";
import { useAuth } from "@/lib/auth";

/**
 * Slim desktop strip above admin and coach pages: keyboard shortcuts and
 * "View as client". Search is the sidebar's "Search everything…" (⌘K), the
 * one search on desktop. There is no Coaching / Membership switch any more:
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
  // Crew is the clients' full-screen feed with its own bar: the strip would sit over the top of every post.
  const isCrew = pathname === "/admin/community" || pathname === "/admin/community/";
  if (isChatRoute || isCrew) return null;

  return (
    <div className="sticky top-0 z-40 hidden items-center justify-end gap-2 border-b border-border bg-background/90 px-6 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:flex">
      <KeyboardShortcutsButton />
      {canClientPov && (
        <button
          type="button"
          onClick={() => {
            try { window.dispatchEvent(new CustomEvent("open-client-pov-picker")); } catch {}
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted"
          aria-label="View as client"
          title="View as client"
        >
          <Eye className="h-3.5 w-3.5 text-muted-foreground" /> View as client
        </button>
      )}
    </div>
  );
}
