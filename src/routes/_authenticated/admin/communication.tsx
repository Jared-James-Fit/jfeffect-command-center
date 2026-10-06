import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { MessagesInbox } from "./messages";

// Only the Messages tab ships with this page. The rest load on first visit so
// opening Messages doesn't download and parse five unrelated admin screens.
const AdminBroadcasts = lazyWithRetry(() => import("./broadcasts").then((m) => ({ default: m.AdminBroadcasts })));
const SupportInbox = lazyWithRetry(() => import("./membership.support").then((m) => ({ default: m.SupportInbox })));
const SupportAlertsPage = lazyWithRetry(() => import("./support-alerts").then((m) => ({ default: m.SupportAlertsPage })));
const ChatGifsPage = lazyWithRetry(() => import("./chat-gifs").then((m) => ({ default: m.ChatGifsPage })));
const ChatSoundsPage = lazyWithRetry(() => import("./chat-sounds").then((m) => ({ default: m.ChatSoundsPage })));
const PopupsManager = lazyWithRetry(() => import("./popups").then((m) => ({ default: m.PopupsManager })));

function TabFallback() {
  return (
    <div className="grid h-40 place-items-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

const TABS = [
  { value: "messages", label: "Messages" },
  { value: "broadcasts", label: "Broadcasts" },
  { value: "support-inbox", label: "Support Inbox" },
  { value: "support-alerts", label: "Support Alerts" },
  { value: "media-libraries", label: "Media Libraries" },
  { value: "popups", label: "Popups" },
] as const;
type TabKey = typeof TABS[number]["value"];

const LAST_TAB_KEY = "jf-admin-communication-last-tab";

function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

type Search = { tab: TabKey; client?: string; sub?: string };

export const Route = createFileRoute("/_authenticated/admin/communication")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const t = raw?.tab;
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
  component: CommunicationWorkspace,
});

function CommunicationWorkspace() {
  const { tab, client, sub } = Route.useSearch();
  const navigate = useNavigate();
  const viewportLockedTab = tab === "messages" || tab === "support-inbox";

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
          subtitle="Manage messages, broadcasts, support, chat assets, and in-app communication."
        />
      </div>
      <div className="shrink-0 border-b border-border bg-background/50">
        <div
          ref={tabsRef}
          onScroll={updateTabFade}
          className="-mb-px flex overflow-x-auto px-1.5 md:gap-1 md:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              </button>
            );
          })}
        </div>
      </div>
      {/* Chat-like tabs own their own scroll (inbox list + thread).
          Page-style tabs scroll the whole panel. Mixing the two causes the
          messenger header/sidebar to drift as the outer container scrolls. */}
      {viewportLockedTab ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "messages" && <MessagesInbox initialClient={client} embedded />}
          {tab === "support-inbox" && <Suspense fallback={<TabFallback />}><SupportInbox embedded /></Suspense>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<TabFallback />}>
            {tab === "support-alerts" && <SupportAlertsPage embedded />}
            {tab === "broadcasts" && <AdminBroadcasts embedded />}
            {tab === "media-libraries" && <MediaLibrariesPanel sub={sub} />}
            {tab === "popups" && <PopupsManager embedded />}
          </Suspense>
        </div>
      )}
    </div>
  );
}

function MediaLibrariesPanel({ sub }: { sub?: string }) {
  const navigate = useNavigate();
  const active = sub === "sounds" ? "sounds" : "gifs";
  const setSub = (next: "gifs" | "sounds") => {
    navigate({
      to: "/admin/communication",
      search: { tab: "media-libraries", sub: next } as any,
      replace: false,
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2 px-4 pt-4 md:px-6">
        <Button size="sm" variant={active === "gifs" ? "default" : "outline"} onClick={() => setSub("gifs")}>GIFs</Button>
        <Button size="sm" variant={active === "sounds" ? "default" : "outline"} onClick={() => setSub("sounds")}>Sounds</Button>
      </div>
      {active === "gifs" ? <ChatGifsPage embedded /> : <ChatSoundsPage embedded />}
    </div>
  );
}