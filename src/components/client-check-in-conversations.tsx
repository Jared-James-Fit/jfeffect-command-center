import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, MessageCircle, Send } from "lucide-react";
import { listManualReviewsForClient } from "@/lib/manual-check-in-reviews";
import { CheckInReviewThread } from "@/components/check-in-review-thread";

export function ClientCheckInConversations({
  clientId,
  onCompose,
}: {
  clientId: string;
  onCompose: () => void;
}) {
  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ["manual-reviews-for-client", clientId],
    queryFn: () => listManualReviewsForClient(clientId),
  });

  const [openId, setOpenId] = useState<string | null>(reviews[0]?.id ?? null);

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Check-In Conversations</h3>
          <p className="text-xs text-muted-foreground mt-1">Past responses + ongoing chats with this client.</p>
        </div>
        <Button size="sm" className="bg-gradient-primary font-bold" onClick={onCompose}>
          <Send className="mr-1 h-4 w-4" /> New Check-In Response
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading…</div>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <MessageCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
          <div className="text-sm font-bold">No check-in responses yet</div>
          <p className="mt-1 text-xs text-muted-foreground">Tap “New Check-In Response” to send your first one. The client can reply back like a text chat.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reviews.map((r) => {
            const open = openId === r.id;
            return (
              <li key={r.id} className="rounded-xl border border-border bg-background/50">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 rounded-xl"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{r.title || "Check-In Response"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Sent {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                    {r.read_at ? "Read" : r.seen_at ? "Seen" : "Sent"}
                  </Badge>
                </button>
                {open && (
                  <div className="px-3 pb-3">
                    <CheckInReviewThread review={r} viewerRole="coach" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}