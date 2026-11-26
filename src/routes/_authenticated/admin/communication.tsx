import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { ChevronLeft, Loader2 } from "lucide-react";
import { MessagesInbox } from "@/route-pages/_authenticated/admin/messages";
import { useAdminNavBadgeCounts } from "@/hooks/use-admin-nav-badges";
import { onPhoneLayoutChange, phoneLayoutNow } from "@/lib/portrait-only";

// Only the Messages tab ships with this page. The rest load on first visit so
// opening Messages doesn't download and parse unrelated admin screens.
const SupportMessenger = lazyWithRetry(() => import("@/components/support/support-messenger").then((m) => ({ default: m.SupportMessenger })));

function TabFallback() {
  return (
    <div className="grid h-40 place-items-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

// Where the page can open. Messages is the inbox (client chats, members'
// Support chats and group chats in one list); `groups` opens it on the
// Groups filter; `support` is app alerts (a workout that didn't load, a sync
// that failed), reached from the inbox's ⋯.
const TABS = [
  { value: "messages", label: "Messages" },
  { value: "groups", label: "Groups" },
  { value: "support", label: "App alerts" },
] as const;
type TabKey = typeof TABS[number]["value"];

/** Old tab names (bookmarks, notifications, redirects) → where that lives now.
 *  Broadcasts were never sent and are gone: ?tab=broadcasts opens Chats. */
const LEGACY_TABS: Record<string, TabKey> = { "support-inbox": "support", "support-alerts": "support" };
const MOVED_TO_SETTINGS: Record<string, string> = {
  popups: "/admin/popups",
  "media-libraries": "/admin/chat-gifs",
};

function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

type Search = { tab: TabKey; client?: string; sub?: string; support?: string; direct?: string; msg?: string; recovery?: string; openipf?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/admin/communication")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const t = typeof raw?.tab === "string" && LEGACY_TABS[raw.tab] ? LEGACY_TABS[raw.tab] : raw?.tab;
    const client = typeof raw?.client === "string" ? (raw.client as string) : undefined;
    // A message in that client's chat to open on (scrolled to and highlighted).
    const msg = client && typeof raw?.msg === "string" && UUID.test(raw.msg) ? raw.msg : undefined;
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    // A member's Support chat (a push, or an old Support-tab ticket link "t:<id>") opens in 1:1 Chats.
    const ticket = /^t:(.+)$/.exec(sub ?? "")?.[1];
    const support = typeof raw?.support === "string" && UUID.test(raw.support) ? raw.support
      : ticket && UUID.test(ticket) ? ticket : undefined;
    if (support) return { tab: "messages", support };
    if (typeof raw?.direct === "string" && UUID.test(raw.direct)) return { tab: "messages", direct: raw.direct };
    // the Recovery queue on one item (a push about a reply waiting for approval)
    if (typeof raw?.recovery === "string" && UUID.test(raw.recovery)) return { tab: "messages", recovery: raw.recovery };
    // OpenIPF's review (a push about athletes found on OpenIPF or new meets)
    if (raw?.openipf != null && raw.openipf !== "") return { tab: "messages", openipf: "1" };
    if (isTab(t)) return { tab: t, client, sub, ...(msg && t === "messages" ? { msg } : {}) };
    // No ?tab= opens Chats, never whichever tab was used last.
    return { tab: "messages", client, sub, ...(msg ? { msg } : {}) };
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
  const { tab, client, sub, support, direct, msg } = Route.useSearch();
  const navigate = useNavigate();
  const viewportLockedTab = tab === "messages" || tab === "groups" || tab === "support";
  const { data: badgeCounts } = useAdminNavBadgeCounts();
  const supportCount = badgeCounts?.supportAlerts ?? 0;

  useEffect(() => {
    if (!viewportLockedTab || typeof window === "undefined") return;
    // the phone layout, a phone on its side included (portrait-only.ts)
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      lockAttr: html.getAttribute("data-messenger-scroll-locked"),
    };
    const apply = () => {
      if (!phoneLayoutNow()) {
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
    const stop = onPhoneLayoutChange(apply);
    return () => {
      stop();
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
        viewportLockedTab ? "phone-column fixed inset-x-0 z-30" : "relative mb-[calc(-140px-env(safe-area-inset-bottom))]",
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
          ? "calc(var(--vv-top, 0px) + var(--app-top-chrome, 0px))"
          : undefined,
        height:
          "calc(var(--vv-h, 100dvh) - var(--app-top-chrome, 0px) - var(--bottom-nav-clearance, 0px))",
      }}
    >
      {/* Desktop-only page title. On a phone the inbox starts right under the
          app bar: its own search, the four filters and ⋯ are everything
          (no tab row: group chats are a filter, app alerts are in ⋯). */}
      <div className="hidden md:block">
        <PageHeader title={tab === "support" ? "App alerts" : "Messages"} />
      </div>
      {tab === "support" && (
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-1.5 py-1 md:px-3">
          <button
            type="button"
            onClick={() => setTab("messages")}
            className="inline-flex h-10 items-center gap-1 rounded-full px-2 text-[15px] font-semibold text-foreground transition hover:bg-secondary"
            data-alerts-back
          >
            <ChevronLeft className="h-5 w-5" /> Messages
          </button>
          <span className="ml-1 text-[15px] font-semibold md:hidden">App alerts{supportCount > 0 ? ` · ${supportCount}` : ""}</span>
        </div>
      )}
      {/* Chat-like tabs own their own scroll (inbox list + thread).
          Page-style tabs scroll the whole panel. Mixing the two causes the
          messenger header/sidebar to drift as the outer container scrolls. */}
      {viewportLockedTab && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "messages" && <MessagesInbox key="chats" initialClient={client} initialMessage={msg} initialSupport={support} initialDirect={direct} embedded view="chats" />}
          {tab === "groups" && <MessagesInbox key="groups" embedded view="groups" />}
          {tab === "support" && (
            <Suspense fallback={<TabFallback />}>
              <SupportMessenger sub={sub} onOpen={(next) => navigate({ to: "/admin/communication", search: { tab: "support", ...(next ? { sub: next } : {}) } as any })} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
