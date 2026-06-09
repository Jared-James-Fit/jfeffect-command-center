import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ExternalLink, Megaphone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { listActiveBroadcastsForUser, markBroadcastGotIt, dismissBroadcastForNow } from "@/lib/broadcasts";
import { BroadcastVoicePlayer, BroadcastVideoPlayer } from "@/components/broadcast-media-player";
import { toast } from "sonner";

export function BroadcastPopupGate() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

  const { data: active = [] } = useQuery({
    queryKey: ["broadcasts-active", userId],
    enabled: !!userId,
    queryFn: () => listActiveBroadcastsForUser(userId!),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const current = active[0] ?? null;

  async function gotIt() {
    if (!current || !userId) return;
    try {
      await markBroadcastGotIt(current.id, userId);
      qc.invalidateQueries({ queryKey: ["broadcasts-active", userId] });
      qc.invalidateQueries({ queryKey: ["broadcasts-history", userId] });
    } catch (e: any) {
      toast.error(e.message ?? "Could not save");
    }
  }

  function later() {
    if (!current) return;
    dismissBroadcastForNow(current.id);
    qc.invalidateQueries({ queryKey: ["broadcasts-active", userId] });
  }

  if (!current) return null;

  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) later(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">{current.title}</DialogTitle>
              <DialogDescription className="text-xs">{current.type} · From Coach Jared</DialogDescription>
            </div>
            <Badge variant="outline" className="text-[10px]">New</Badge>
          </div>
        </DialogHeader>

        {current.body && (
          <div className={current.type === "Quote"
            ? "rounded-2xl bg-muted/40 p-4 text-center text-base italic leading-relaxed"
            : "rounded-2xl bg-muted/40 p-4 text-sm leading-relaxed whitespace-pre-wrap"
          }>
            {current.body}
          </div>
        )}

        {current.type === "Voice Message" && (
          <BroadcastVoicePlayer voicePath={current.voice_path} transcript={current.transcript} />
        )}

        {current.type === "Video" && (
          <BroadcastVideoPlayer videoPath={current.video_path} videoUrl={current.video_url} />
        )}

        {current.link_url && (
          <a href={current.link_url} target="_blank" rel="noreferrer">
            <Button variant="outline" className="w-full">
              <ExternalLink className="mr-1 h-4 w-4" /> {current.link_label || "Open link"}
            </Button>
          </a>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" size="sm" onClick={later}>View Later</Button>
          <Button size="sm" onClick={gotIt} className="bg-gradient-primary font-bold">
            <CheckCircle2 className="mr-1 h-4 w-4" /> Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}