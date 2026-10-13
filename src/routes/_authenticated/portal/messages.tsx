import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listenChannel } from "@/lib/realtime-channel";
import { usePortalUserId, useViewingAsClient } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { MessageThread } from "@/components/message-thread";
import { useChatPresence, LiveDot } from "@/hooks/use-chat-presence";
import { GroupChatsPane, type PinnedChat } from "@/components/group-chats-pane";
import { GroupChatErrorBoundary } from "@/components/group-chat-error-boundary";
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
import { Phone, MessageSquare, AlertTriangle, Mail, ChevronLeft } from "lucide-react";
import { formatDistanceToNowStrict, isToday, format } from "date-fns";
import { UserAvatar } from "@/components/user-avatar";
import { markRead, markUnread } from "@/lib/messages";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portal/messages")({
  component: ClientMessages,
});

type CoachLast = { body: string | null; sender_role: string; created_at: string; read_by_client_at: string | null; attachments: any[] | null };

function ClientMessages() {
  const portalUserId = usePortalUserId();
  const [confirm, setConfirm] = useState<null | "call" | "sms">(null);
  const qc = useQueryClient();

  const { data: client } = useQuery({
    queryKey: ["my-client-id", portalUserId],
    enabled: !!portalUserId,
    // A person's client row id doesn't change: don't make every open wait on this lookup.
    staleTime: 30 * 60_000,
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

  // Viewing as the client must not show them as online in the coach's inbox.
  const viewingAsClient = useViewingAsClient();
  // The coach sees me "live" only while I have our chat open (not the list).
  const [coachChatOpen, setCoachChatOpen] = useState(false);
  const { peerLive: coachLive } = useChatPresence(viewingAsClient ? null : client?.id ?? null, "client", coachChatOpen);

  const { data: coach } = useQuery({
    queryKey: ["my-assigned-coach", client?.assigned_coach_id],
    enabled: !!client?.assigned_coach_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("coaches")
        .select("id, full_name, phone, profile_picture_url")
        .eq("id", client!.assigned_coach_id!)
        .maybeSingle();
      return data;
    },
  });

  // Coach row preview: latest message + whether it's unread for me (the
  // coach's latest, so "Mark as Unread" shows even after my own reply).
  const { data: coachLast } = useQuery({
    queryKey: ["coach-chat-last", client?.id],
    enabled: !!client?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const base = () => (supabase.from("messages") as any)
        .select("body, sender_role, created_at, read_by_client_at, attachments")
        .eq("client_id", client!.id)
        .eq("is_internal_note", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const [{ data: last }, { data: fromCoach }] = await Promise.all([
        base().maybeSingle(),
        base().neq("sender_role", "client").maybeSingle(),
      ]);
      if (!last) return null;
      return { ...(last as CoachLast), coachUnread: !!fromCoach && !(fromCoach as CoachLast).read_by_client_at };
    },
  });
  useEffect(() => {
    if (!client?.id) return;
    const ch = listenChannel(`coach-chat-row-${client.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `client_id=eq.${client.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["coach-chat-last", client.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [client?.id, qc]);

  const coachName = coach?.full_name ?? "Coach Jared";
  const coachTel = coach?.phone ? String(coach.phone).replace(/[^+\d]/g, "") : "";
  const callEnabled = !!client?.coach_call_access_enabled && !!coachTel;
  const smsEnabled = !!client?.coach_sms_access_enabled && !!coachTel;

  const coachUnread = !!coachLast?.coachUnread;
  const coachPreview = coachLast
    ? `${coachLast.sender_role === "client" ? "You: " : ""}${coachLast.body?.trim() || (coachLast.attachments?.length ? "Attachment" : "")}`
    : "Message your coach";
  const coachWhen = coachLast
    ? isToday(new Date(coachLast.created_at)) ? format(new Date(coachLast.created_at), "h:mm a") : formatDistanceToNowStrict(new Date(coachLast.created_at), { addSuffix: false })
    : "";

  const markCoachUnread = async () => {
    if (!client?.id) return;
    await markUnread(client.id, "client");
    qc.invalidateQueries({ queryKey: ["client-nav-badges"] });
    qc.invalidateQueries({ queryKey: ["coach-chat-last", client.id] });
    toast.success("Marked as unread");
  };

  // Always first in the list, iMessage style: it can be marked unread, never
  // unpinned, muted or deleted.
  const pinned: PinnedChat = {
    id: "coach",
    name: coachName,
    avatarUrl: coach?.profile_picture_url ?? null,
    live: coachLive,
    preview: coachPreview,
    when: coachWhen,
    searchText: `${coachName} coach ${coachLast?.body ?? ""}`,
    unread: coachUnread,
    markUnread: markCoachUnread,
    onOpenChange: setCoachChatOpen,
    markRead: async () => {
      if (!client?.id) return;
      await markRead(client.id, "client");
      qc.invalidateQueries({ queryKey: ["client-nav-badges"] });
      qc.invalidateQueries({ queryKey: ["coach-chat-last", client.id] });
    },
    renderThread: ({ onBack }) => (
      <>
      <header
        className="flex items-center gap-2.5 border-b border-border bg-card/80 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/60 md:px-6"
      >
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 md:hidden" onClick={onBack} aria-label="All chats">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="relative shrink-0">
          <UserAvatar
            src={coach?.profile_picture_url ?? null}
            name={coachName}
            size={40}
            ring
            expandable={false}
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
        {client?.id && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Mark conversation as unread"
            onClick={markCoachUnread}
          >
            <Mail className="h-4 w-4" />
          </Button>
        )}
      </header>
        {!client ? (
          <div className="p-6">
            <Card className="border-border bg-card p-6 text-sm text-muted-foreground">
              Your coach hasn't set up your profile yet. Messaging will be available once they do.
            </Card>
          </div>
        ) : (
          <MessageThread clientId={client.id} role="client" fullBleed />
        )}
      </>
    ),
  };

  return (
    <div
      className="fixed inset-x-0 z-30 flex flex-col bg-background md:static md:inset-auto md:z-auto md:h-full md:flex-1"
      style={{
        // Anchor the chat to the iOS Visual Viewport. --vv-h / --vv-top are
        // updated live by useKeyboardOpen() so the container shrinks and
        // re-positions when the on-screen keyboard opens (100dvh alone does
        // NOT shrink on iOS Safari, which is what creates the dead black
        // gap above the keyboard). Falls back to 100dvh on browsers without
        // the Visual Viewport API.
        // NOTE: --shell-topbar-h only measures the topbar's content row; on
        // notched devices the topbar also has env(safe-area-inset-top) of
        // padding above it. Include that inset here so the fixed messenger
        // starts BELOW the "Client Portal" top bar instead of covering it.
        top: "calc(var(--vv-top, 0px) + var(--shell-topbar-h, 0px))",
        height:
          "calc(var(--vv-h, 100dvh) - var(--shell-topbar-h, 0px) - var(--bottom-nav-clearance, 0px))",
      }}
    >
      {/* One inbox, like iMessage: the coach chat pinned first, then your own
          pins, then groups and 1:1 chats by most recent. Only chat? It opens
          straight into it, and back still shows the list (compose, New group). */}
      <div className="min-h-0 flex-1">
        <GroupChatErrorBoundary>
          <GroupChatsPane asAdmin={false} pinned={pinned} />
        </GroupChatErrorBoundary>
      </div>

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