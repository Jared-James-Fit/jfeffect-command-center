import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "‹ Today" pill for quick looks from the admin dashboard.
 *
 * Tapping a dashboard number / card link arms it with the destination path. The pill then
 * shows on that page (and anything under it, e.g. a client opened from the filtered list)
 * and disappears as soon as you go somewhere else or back to the dashboard. Deliberate moves
 * (quick actions, the nav bar) never arm it.
 */
const KEY = "jf-return-dashboard";
const DASHBOARD = "/admin";
const ARM_WINDOW_MS = 8000;
/** Routes that redirect before rendering: where the user actually lands. */
const LANDS_ON: Record<string, string> = { "/admin/messages": "/admin/communication" };

type Marker = { path: string; at: number; landed?: boolean };

const read = (): Marker | null => {
  try { const raw = sessionStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Marker) : null; } catch { return null; }
};
const write = (m: Marker | null) => {
  try { if (m) sessionStorage.setItem(KEY, JSON.stringify(m)); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Where an href lands after redirects. */
export function landingPath(href: string): string {
  const path = norm(new URL(href, "http://x").pathname);
  return LANDS_ON[path] ?? path;
}

/** Is `pathname` the armed page or inside it? */
export function withinReturnScope(pathname: string, base: string): boolean {
  const p = norm(pathname);
  return p === base || p.startsWith(`${base}/`);
}

/** Call from the dashboard's click handler for links that are a quick look. */
export function armReturnToDashboard(href: string) {
  const path = landingPath(href);
  if (path === DASHBOARD) return;
  write({ path, at: Date.now() });
}

/**
 * Dashboard container click-capture: arms the pill for any internal link that isn't inside a
 * `[data-no-return]` area (quick actions).
 */
export function onDashboardClickCapture(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.closest("[data-no-return]")) return;
  const href = a.getAttribute("href") ?? "";
  if (!href.startsWith("/admin/")) return;
  armReturnToDashboard(href);
}

export function ReturnToDashboardPill() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> | undefined });
  const [show, setShow] = useState(false);

  useEffect(() => {
    const p = norm(pathname);
    const m = read();
    if (p === DASHBOARD || !m) { if (p === DASHBOARD) write(null); setShow(false); return; }
    if (!m.landed) {
      // Only the navigation the tap started counts, so a stale marker can't pop up later.
      if (p === m.path && Date.now() - m.at < ARM_WINDOW_MS) { write({ ...m, landed: true }); setShow(true); }
      else if (Date.now() - m.at >= ARM_WINDOW_MS) { write(null); setShow(false); }
      return;
    }
    if (withinReturnScope(p, m.path)) setShow(true);
    else { write(null); setShow(false); }
  }, [pathname]);

  if (!show) return null;
  // A phone chat thread has its own back button and a composer at the bottom.
  const threadOpen = typeof search?.client === "string" && norm(pathname) === "/admin/communication";

  return (
    <button
      type="button"
      onClick={() => { write(null); setShow(false); navigate({ to: DASHBOARD }); }}
      aria-label="Back to Today"
      className={cn(
        "fixed z-40 inline-flex h-10 items-center gap-0.5 rounded-full pl-2 pr-3.5 text-sm font-semibold",
        "bg-card/90 text-foreground shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)] ring-1 ring-border backdrop-blur-md",
        "transition active:scale-95 animate-in fade-in slide-in-from-bottom-2 duration-200",
        "left-4 bottom-[calc(max(env(safe-area-inset-bottom),6px)+84px)] md:bottom-6 md:left-1/2 md:-translate-x-1/2",
        threadOpen && "max-md:hidden",
      )}
      data-viewport-pinned
    >
      <ChevronLeft className="h-4 w-4 text-primary" />
      Today
    </button>
  );
}
