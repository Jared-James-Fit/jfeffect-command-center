import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, MessageCircle, Loader2 } from "lucide-react";
import {
  listReviewMessages,
  postReviewMessage,
  markThreadRead,
  type ManualCheckInReview,
  type ReviewMessage,
} from "@/lib/manual-check-in-reviews";
import { cn } from "@/lib/utils";

type Props = {
  review: ManualCheckInReview;
  viewerRole: "coach" | "client";
  /** Auto-mark thread read for viewer on mount + on new messages. Default true. */
  autoMarkRead?: boolean;
  className?: string;
};

function formatStamp(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CheckInReviewThread({ review, viewerRole, autoMarkRead = true, className }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["review-thread", review.id],
    queryFn: () => listReviewMessages(review.id),
    refetchOnWindowFocus: false,
  });

  // Build the visible message list: synthesize the first "coach" message from the review itself.
  const fullThread = useMemo<ReviewMessage[]>(() => {
    const opener: ReviewMessage = {
      id: `opener-${review.id}`,
      review_id: review.id,
      sender_role: "coach",
      sender_user_id: review.coach_user_id,
      body: [
        review.message,
        review.action_items ? `\n\n🎯 Focus this week:\n${review.action_items}` : "",
      ].join(""),
      created_at: review.created_at,
    };
    return [opener, ...messages];
  }, [review, messages]);

  // Realtime: refetch on inserts in this thread
  useEffect(() => {
    const ch = supabase
      .channel(`review-thread-${review.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "manual_check_in_review_messages", filter: `review_id=eq.${review.id}` },
        () => qc.invalidateQueries({ queryKey: ["review-thread", review.id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [review.id, qc]);

  // Mark as read
  useEffect(() => {
    if (!autoMarkRead) return;
    markThreadRead(review.id, viewerRole).catch(() => {});
    if (viewerRole === "client" && !review.read_at) {
      // also legacy read_at so existing dot/badge clears
      (supabase.from("manual_check_in_reviews") as any)
        .update({ read_at: new Date().toISOString() })
        .eq("id", review.id)
        .then(() => {});
    }
  }, [review.id, viewerRole, autoMarkRead, messages.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [fullThread.length]);

  async function send() {
    if (!user) return;
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await postReviewMessage({
        reviewId: review.id,
        senderRole: viewerRole,
        senderUserId: user.id,
        body: draft,
      });
      setDraft("");
      qc.invalidateQueries({ queryKey: ["review-thread", review.id] });
      qc.invalidateQueries({ queryKey: ["manual-reviews-for-client", review.client_id] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not send reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-bold">
          <MessageCircle className="h-4 w-4 text-primary" />
          {review.title || "Check-In Response"}
        </div>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
          Sent {new Date(review.created_at).toLocaleDateString()}
        </Badge>
      </div>

      <div ref={scrollRef} className="max-h-[420px] min-h-[180px] space-y-2 overflow-y-auto px-3 py-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading messages…
          </div>
        ) : (
          fullThread.map((m) => {
            const mine = m.sender_role === viewerRole;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className="max-w-[85%]">
                  <div
                    className={cn(
                      "whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                      mine
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md",
                    )}
                  >
                    {m.body}
                  </div>
                  <div className={cn("mt-1 text-[10px] text-muted-foreground", mine ? "text-right" : "text-left")}>
                    {m.sender_role === "coach" ? "Coach Jared" : "Client"} · {formatStamp(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={viewerRole === "coach" ? "Reply to client…" : "Reply to Coach Jared…"}
          rows={2}
          className="min-h-[44px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          onClick={send}
          disabled={!draft.trim() || sending}
          size="icon"
          className="bg-gradient-primary"
          aria-label="Send reply"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}