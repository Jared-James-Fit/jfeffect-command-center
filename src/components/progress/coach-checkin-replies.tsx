/**
 * CoachCheckinReplies — shows recent coach replies to weekly check-ins.
 * Displayed in the Progress Snapshot section on the client/member home.
 *
 * Mobile-first, clean, fast.
 * Newest reply first. Tap to open the full thread.
 */

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, ChevronRight, Send, Archive, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  listMyCheckinThreads,
  getCheckinThread,
  replyToCheckinThread,
  archiveCheckinThread,
} from "@/lib/weekly-checkin-threads.functions";

export function CoachCheckinReplies() {
  const listFn = useServerFn(listMyCheckinThreads);
  const getThreadFn = useServerFn(getCheckinThread);
  const replyFn = useServerFn(replyToCheckinThread);
  const archiveFn = useServerFn(archiveCheckinThread);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-checkin-threads"],
    queryFn: () => listFn(),
    staleTime: 30_000,
  });

  const threads = data?.threads ?? [];

  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  const { data: threadData, isLoading: threadLoading, refetch: refetchThread } = useQuery({
    queryKey: ["checkin-thread", openThreadId],
    queryFn: () => getThreadFn({ data: { threadId: openThreadId! } }),
    enabled: !!openThreadId,
    staleTime: 10_000,
  });

  const messages = threadData?.thread?.weekly_checkin_messages ?? [];
  const sortedMessages = [...messages].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const handleReply = async () => {
    if (!openThreadId || !replyText.trim()) return;
    setReplying(true);
    try {
      await replyFn({ data: { threadId: openThreadId, messageText: replyText.trim() } });
      setReplyText("");
      await refetchThread();
      toast.success("Reply sent");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send reply");
    } finally {
      setReplying(false);
    }
  };

  const handleArchive = async (threadId: string) => {
    try {
      await archiveFn({ data: { threadId, archiveFor: "client" } });
      await refetch();
      toast.success("Archived");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not archive");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading replies…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
        No coach replies yet. Submit a weekly check-in to start a conversation.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {threads.slice(0, 5).map((thread: any) => {
          const msgs = thread.weekly_checkin_messages ?? [];
          const coachMsgs = msgs.filter((m: any) => m.sender_role === "coach" || m.sender_role === "admin");
          const latestCoach = coachMsgs.sort(
            (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0];
          const unreadCount = coachMsgs.length;

          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => setOpenThreadId(thread.id)}
              className="w-full text-left rounded-xl border border-border bg-card p-3 transition hover:border-primary/40 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-muted-foreground truncate">
                      {format(new Date(thread.updated_at), "MMM d, yyyy")}
                    </div>
                    {latestCoach ? (
                      <p className="text-sm text-foreground truncate mt-0.5">
                        {latestCoach.message_text.slice(0, 80)}{latestCoach.message_text.length > 80 ? "…" : ""}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic mt-0.5">No reply yet</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {unreadCount > 0 && (
                    <Badge className="text-[10px] px-1.5 py-0.5">{unreadCount}</Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Thread detail sheet */}
      <Sheet open={!!openThreadId} onOpenChange={(v) => { if (!v) { setOpenThreadId(null); setReplyText(""); } }}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl pb-safe flex flex-col">
          <SheetHeader className="pb-3 border-b border-border">
            <SheetTitle className="text-base font-black flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Coach Check-In Reply
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pt-3 pb-2">
            {threadLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sortedMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No messages yet.</p>
            ) : (
              sortedMessages.map((msg: any) => {
                const isCoach = msg.sender_role === "coach" || msg.sender_role === "admin";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isCoach ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        isCoach
                          ? "bg-muted/60 text-foreground rounded-tl-sm"
                          : "bg-primary text-primary-foreground rounded-tr-sm"
                      }`}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70 mb-1">
                        {isCoach ? "Coach Jared" : "You"} · {format(new Date(msg.created_at), "MMM d, h:mma")}
                      </div>
                      <p className="whitespace-pre-wrap">{msg.message_text}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Reply input */}
          <div className="border-t border-border pt-3 space-y-2">
            <Textarea
              placeholder="Write a reply…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void handleReply();
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="lg"
                onClick={handleReply}
                disabled={replying || !replyText.trim()}
              >
                {replying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {replying ? "Sending…" : "Send Reply"}
              </Button>
              {openThreadId && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => { void handleArchive(openThreadId); setOpenThreadId(null); }}
                >
                  <Archive className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
