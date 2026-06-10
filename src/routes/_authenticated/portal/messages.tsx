import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { MessageThread } from "@/components/message-thread";
import { NotificationBell } from "@/components/notification-bell";
import { useChatPresence, LiveDot } from "@/hooks/use-chat-presence";
import { GroupChatsPane, useMyGroupSummary } from "@/components/group-chats-pane";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/portal/messages")({
  component: ClientMessages,
});

function ClientMessages() {
  const portalUserId = usePortalUserId();
  const [tab, setTab] = useState<"coach" | "groups">("coach");
  const groupSummary = useMyGroupSummary();

  const { data: client } = useQuery({
    queryKey: ["my-client-id", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle();
      return data;
    },
  });

  const { peerLive: coachLive } = useChatPresence(client?.id ?? null, "client");

  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex flex-col bg-background md:static md:inset-auto md:z-auto md:h-full md:flex-1"
      style={{
        // On mobile, use the dynamic viewport so the chat tracks the
        // visible area (URL bar collapse + on-screen keyboard).
        height: "calc(100dvh - var(--bottom-nav-clearance, 0px))",
      }}
    >
      {/* Slim chat header — coach identity, not a giant page hero */}
      <header
        className="flex items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/60 md:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
      >
        <span className="relative shrink-0">
          <img
            src="/logo.png"
            alt="Coach Jared"
            className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
          />
          {coachLive && (
            <span className="absolute bottom-0 right-0"><LiveDot /></span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black tracking-tight">Coach Jared</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {coachLive ? (
              <span className="font-semibold text-emerald-600">● Live in chat</span>
            ) : (
              "Direct line · usually replies within a day"
            )}
          </div>
        </div>
        <NotificationBell />
      </header>

      {/* Coach Chat | Group Chats toggle — only when the client has groups */}
      {groupSummary.hasGroups && (
        <div className="flex items-center justify-center gap-2 border-b border-border bg-card/60 px-3 py-2">
          <div className="inline-flex rounded-full bg-secondary/60 p-0.5 text-xs">
            <button
              onClick={() => setTab("coach")}
              className={cn(
                "rounded-full px-3 py-1 font-semibold transition",
                tab === "coach" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              Coach Chat
            </button>
            <button
              onClick={() => setTab("groups")}
              className={cn(
                "relative rounded-full px-3 py-1 font-semibold transition",
                tab === "groups" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              Group Chats
              {groupSummary.unread > 0 && (
                <Badge className="ml-1 h-4 min-w-[16px] rounded-full px-1 text-[10px]">
                  {groupSummary.unread}
                </Badge>
              )}
            </button>
          </div>
        </div>
      )}

      {tab === "groups" ? (
        <div className="min-h-0 flex-1">
          <GroupChatErrorBoundary>
            <GroupChatsPane asAdmin={false} />
          </GroupChatErrorBoundary>
        </div>
      ) : !client ? (
        <div className="p-6">
          <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
            Your coach hasn't set up your profile yet. Messaging will be available once they do.
          </Card>
        </div>
      ) : (
        <MessageThread clientId={client.id} role="client" fullBleed />
      )}
    </div>
  );
}