import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listUnreadForClientUser, markReviewSeen, markReviewRead, dismissReviewForNow, sourceLabel } from "@/lib/manual-check-in-reviews";
import { MessageCircle, CheckCircle2, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

export function ManualCheckInReviewModal({ clientId }: { clientId: string | null | undefined }) {
  const qc = useQueryClient();

  const { data: unread = [] } = useQuery({
    queryKey: ["manual-reviews-unread", clientId],
    enabled: !!clientId,
    queryFn: () => listUnreadForClientUser(clientId!),
    refetchOnWindowFocus: false,
  });

  const current = unread[0] ?? null;

  useEffect(() => {
    if (current && !current.seen_at) {
      markReviewSeen(current.id).catch(() => {});
    }
  }, [current?.id]);

  if (!current) return null;

  async function handleGotIt() {
    if (!current) return;
    try {
      await markReviewRead(current.id);
      toast.success("Saved to your Check-In Reviews");
      qc.invalidateQueries({ queryKey: ["manual-reviews-unread", clientId] });
      qc.invalidateQueries({ queryKey: ["manual-reviews-for-client", clientId] });
    } catch (e: any) {
      toast.error(e.message ?? "Could not mark as read");
    }
  }

  async function handleLater() {
    if (!current) return;
    try {
      await dismissReviewForNow(current.id);
      qc.invalidateQueries({ queryKey: ["manual-reviews-unread", clientId] });
    } catch {}
  }

  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) handleLater(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">{current.title || "Check-In Review"}</DialogTitle>
              <DialogDescription className="text-xs">From Coach Jared · {sourceLabel(current.source)}</DialogDescription>
            </div>
            <Badge variant="outline" className="text-[10px]">New</Badge>
          </div>
        </DialogHeader>

        <div className="rounded-2xl bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {current.message}
        </div>

        <p className="text-[11px] text-muted-foreground">
          This will keep popping up each time you open the app until you tap <span className="font-bold">Got it</span> to confirm.
        </p>

        {current.action_items && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Action Items</div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{current.action_items}</div>
          </div>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Link to="/portal/messages">
            <Button variant="ghost" size="sm">
              <MessageCircle className="mr-1 h-4 w-4" /> Message Coach
            </Button>
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleLater}>View Later</Button>
            <Button size="sm" onClick={handleGotIt} className="bg-gradient-primary font-bold">
              <CheckCircle2 className="mr-1 h-4 w-4" /> Got it
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}