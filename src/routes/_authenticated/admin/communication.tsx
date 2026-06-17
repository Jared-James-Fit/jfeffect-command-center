import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MessagesInbox } from "./messages";
import { AdminBroadcasts } from "./broadcasts";
import { SupportInbox } from "./membership.support";
import { SupportAlertsPage } from "./support-alerts";
import { ChatGifsPage } from "./chat-gifs";
import { ChatSoundsPage } from "./chat-sounds";
import { PopupsManager } from "./popups";

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

  useMemo(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {}
  }, [tab]);

  const setTab = (next: TabKey) => {
    navigate({ to: "/admin/communication", search: { tab: next } as any, replace: false });
  };

  return (
    <div
      className="flex flex-col"
      style={{
        // Subtract both the AppShell mobile top bar AND the bottom-nav
        // clearance so the messenger composer always lands exactly above
        // the bottom tab bar — no body scroll, no glitch where the topbar
        // and composer fight for the same vertical space.
        height:
          "calc(100dvh - var(--shell-topbar-h, 0px) - var(--bottom-nav-clearance, 0px))",
      }}
    >
      <PageHeader
        title="Communication"
        subtitle="Manage messages, broadcasts, support, chat assets, and in-app communication."
      />
      <div className="shrink-0 border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
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
      {tab === "messages" || tab === "support-inbox" || tab === "support-alerts" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "messages" && <MessagesInbox initialClient={client} embedded />}
          {tab === "support-inbox" && <SupportInbox embedded />}
          {tab === "support-alerts" && <SupportAlertsPage embedded />}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "broadcasts" && <AdminBroadcasts embedded />}
          {tab === "media-libraries" && <MediaLibrariesPanel sub={sub} />}
          {tab === "popups" && <PopupsManager embedded />}
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