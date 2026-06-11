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
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Phone, MessageSquare, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/messages")({
  component: ClientMessages,
});

function ClientMessages() {
  const portalUserId = usePortalUserId();
  const [tab, setTab] = useState<"coach" | "groups">("coach");
  const groupSummary = useMyGroupSummary();
  const [confirm, setConfirm] = useState<null | "call" | "sms">(null);

  const { data: client } = useQuery({
    queryKey: ["my-client-id", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select(
          "id, full_name, coach_call_access_enabled, coach_sms_access_enabled, assigned_coach_id",
        )
        .eq("user_id", portalUserId!)
        .maybeSingle();
      return data;
    },
  });

  const { peerLive: coachLive } = useChatPresence(client?.id ?? null, "client");

  const { data: coach } = useQuery({
    queryKey: ["my-assigned-coach", client?.assigned_coach_id],
    enabled: !!client?.assigned_coach_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("coaches")
        .select("id, full_name, phone")
        .eq("id", client!.assigned_coach_id!)
        .maybeSingle();
      return data;
    },
  });

  const coachName = coach?.full_name ?? "Coach Jared";
  const coachTel = coach?.phone ? String(coach.phone).replace(/[^+\d]/g, "") : "";
  const callEnabled = !!client?.coach_call_access_enabled && !!coachTel;
  const smsEnabled = !!client?.coach_sms_access_enabled && !!coachTel;

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
            alt={coachName}
            className="h-10 w-10 rounded-full object-cover ring-1 ring-border"
          />
          {coachLive && (
            <span className="absolute bottom-0 right-0"><LiveDot /></span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black tracking-tight">{coachName}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {coachLive ? (
              <span className="font-semibold text-emerald-600">● Live in chat</span>
            ) : (
              "Direct line · usually replies within a day"
            )}
          </div>
        </div>
        {callEnabled && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            title={`Call ${coachName}`}
            onClick={() => setConfirm("call")}
          >
            <Phone className="h-4 w-4" />
          </Button>
        )}
        {smsEnabled && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            title={`Text ${coachName}`}
            onClick={() => setConfirm("sms")}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}
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

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              For urgent or important matters only
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "call"
                ? `Calling ${coachName} directly should only be used when something is urgent or important. For everything else, please use the chat above so your coach can reply when available.`
                : `Texting ${coachName} directly should only be used when something is urgent or important. For everything else, please use the chat above so your coach can reply when available.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <a
                href={confirm === "call" ? `tel:${coachTel}` : `sms:${coachTel}`}
                onClick={() => setConfirm(null)}
              >
                {confirm === "call" ? "Call now" : "Text now"}
              </a>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}