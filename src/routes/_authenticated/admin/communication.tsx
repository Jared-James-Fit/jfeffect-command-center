import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { Loader2, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MessagesInbox } from "@/route-pages/_authenticated/admin/messages";
import { useAdminNavBadgeCounts } from "@/hooks/use-admin-nav-badges";

// Only the Messages tab ships with this page. The rest load on first visit so
// opening Messages doesn't download and parse unrelated admin screens.
const AdminBroadcasts = lazyWithRetry(() => import("@/route-pages/_authenticated/admin/broadcasts").then((m) => ({ default: m.AdminBroadcasts })));
const SupportMessenger = lazyWithRetry(() => import("@/components/support/support-messenger").then((m) => ({ default: m.SupportMessenger })));

function TabFallback() {
  return (
    <div className="grid h-40 place-items-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

const TABS = [
  { value: "messages", label: "1:1 Chats" },
  { value: "groups", label: "Groups" },
  { value: "support", label: "Support" },
  { value: "broadcasts", label: "Broadcasts" },
] as const;
type TabKey = typeof TABS[number]["value"];

/** Old tab names (bookmarks, notifications, redirects) → where that lives now. */
const LEGACY_TABS: Record<string, TabKey> = { "support-inbox": "support", "support-alerts": "support" };
const MOVED_TO_SETTINGS: Record<string, string> = {
  popups: "/admin/popups",
  "media-libraries": "/admin/chat-gifs",
};

const LAST_TAB_KEY = "jf-admin-communication-last-tab";

function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

type Search = { tab: TabKey; client?: string; sub?: string };

export const Route = createFileRoute("/_authenticated/admin/communication")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const t = typeof raw?.tab === "string" && LEGACY_TABS[raw.tab] ? LEGACY_TABS[raw.tab] : raw?.tab;
    const client = typeof raw?.client === "string" ? (raw.client as string) : undefined;
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    if (isTab(t)) return { tab: t, client, sub };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(LAST_TAB_KEY);
        if (isTab(stored)) return { tab: stored, client, sub };
      } catch {}
    }
    return { tab: "messages", client, sub };
  },
  beforeLoad: ({ location }) => {
    const raw = (location.search as Record<string, unknown>)?.tab;
    if (typeof raw === "string" && MOVED_TO_SETTINGS[raw]) {
      const to = raw === "media-libraries" && (location.search as any)?.sub === "sounds" ? "/admin/chat-sounds" : MOVED_TO_SETTINGS[raw];
      throw redirect({ to: to as any, replace: true });
    }
  },
  component: CommunicationWorkspace,
});

function CommunicationWorkspace() {
  const { tab, client, sub } = Route.useSearch();
  const navigate = useNavigate();
  const viewportLockedTab = tab === "messages" || tab === "groups" || tab === "support";
  const { data: badgeCounts } = useAdminNavBadgeCounts();
  const supportCount = (badgeCounts?.supportAlerts ?? 0) + (badgeCounts?.supportTickets ?? 0);

  // Tabs scroll sideways on phones: fade whichever edge has more tabs, and
  // keep the active tab in view.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabFade, setTabFade] = useState<string | null>(null);
  const updateTabFade = () => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setTabFade(left || right
      ? `linear-gradient(to right, ${left ? "transparent, #000 28px" : "#000"}, ${right ? "#000 calc(100% - 28px), transparent" : "#000"})`
      : null);
  };
  useEffect(() => {
    const el = tabsRef.current;
    const btn = el?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (el && btn) {
      const target = btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    }
    updateTabFade();
    window.addEventListener("resize", updateTabFade);
    return () => window.removeEventListener("resize", updateTabFade);
  }, [tab]);

  useMemo(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {}
  }, [tab]);

  useEffect(() => {
    if (!viewportLockedTab || typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      lockAttr: html.getAttribute("data-messenger-scroll-locked"),
    };
    const apply = () => {
      if (!mq.matches) {
        html.style.overflow = previous.htmlOverflow;
        body.style.overflow = previous.bodyOverflow;
        body.style.overscrollBehavior = previous.bodyOverscroll;
        if (previous.lockAttr === null) html.removeAttribute("data-messenger-scroll-locked");
        else html.setAttribute("data-messenger-scroll-locked", previous.lockAttr);
        return;
      }
      html.setAttribute("data-messenger-scroll-locked", "true");
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      if (previous.lockAttr === null) html.removeAttribute("data-messenger-scroll-locked");
      else html.setAttribute("data-messenger-scroll-locked", previous.lockAttr);
    };
  }, [viewportLockedTab]);

  const setTab = (next: TabKey) => {
    navigate({ to: "/admin/communication", search: { tab: next } as any, replace: false });
  };

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background md:static md:inset-auto md:z-auto md:mb-0",
        viewportLockedTab ? "fixed inset-x-0 z-30" : "relative mb-[calc(-140px-env(safe-area-inset-bottom))]",
      )}
      style={{
        // Anchor the entire communication workspace to the iOS Visual
        // Viewport. `100dvh` does NOT shrink on iOS Safari when the soft
        // keyboard opens, which leaves a huge dead gap between the
        // composer and the keyboard. `--vv-h` (updated live by
        // useKeyboardOpen()) does shrink, so the composer always sits
        // exactly above the keyboard with no body scroll. We also
        // subtract the topbar and bottom-nav clearance; when the keyboard
        // opens, --bottom-nav-clearance collapses to 0 (the nav is
        // hidden), so the math stays correct.
        top: viewportLockedTab
          ? "calc(var(--vv-top, 0px) + var(--shell-topbar-h, 0px))"
          : undefined,
        height:
          "calc(var(--vv-h, 100dvh) - var(--shell-topbar-h, 0px) - var(--bottom-nav-clearance, 0px))",
      }}
    >
      {/* Desktop-only page header. On mobile the screen jumps straight to the
          communication tabs to avoid wasting vertical space above the inbox. */}
      <div className="hidden md:block">
        <PageHeader
          title="Communication"
          subtitle="Chats, group chats, support and broadcasts. Popups and chat media live in Settings."
        />
      </div>
      <div className="flex shrink-0 items-center border-b border-border bg-background/50">
        <div
          ref={tabsRef}
          onScroll={updateTabFade}
          className="-mb-px flex min-w-0 flex-1 overflow-x-auto px-1.5 md:gap-1 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={tabFade ? { WebkitMaskImage: tabFade, maskImage: tabFade } : undefined}
        >
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                data-tab={t.value}
                onClick={() => setTab(t.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2.5 md:px-3 text-[13px] font-semibold transition-colors md:text-sm md:py-3",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {t.label}
                {t.value === "support" && supportCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-destructive px-1.5 align-[1px] text-[10px] font-bold leading-4 text-destructive-foreground">
                    {supportCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Link
          to="/admin/automations"
          aria-label="Automations"
          title="Automated texts, messages and posts"
          className="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground md:mr-4 md:w-auto md:gap-1 md:px-3 md:inline-flex md:text-xs md:font-semibold"
        >
          <Zap className="h-4 w-4" />
          <span className="hidden md:inline">Automations</span>
        </Link>
      </div>
      {/* Chat-like tabs own their own scroll (inbox list + thread).
          Page-style tabs scroll the whole panel. Mixing the two causes the
          messenger header/sidebar to drift as the outer container scrolls. */}
      {viewportLockedTab ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "messages" && <MessagesInbox key="chats" initialClient={client} embedded view="chats" />}
          {tab === "groups" && <MessagesInbox key="groups" embedded view="groups" />}
          {tab === "support" && (
            <Suspense fallback={<TabFallback />}>
              <SupportMessenger sub={sub} onOpen={(next) => navigate({ to: "/admin/communication", search: { tab: "support", ...(next ? { sub: next } : {}) } as any })} />
            </Suspense>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<TabFallback />}>
            {tab === "broadcasts" && <AdminBroadcasts embedded />}
          </Suspense>
        </div>
      )}
    </div>
  );
}
