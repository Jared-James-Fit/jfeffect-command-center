import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientLiftVideoUploader } from "@/components/client-lift-video-uploader";
import { LiftVideoCard } from "@/components/lift-video-card";
import {
  listLiftVideos,
  markClientViewed,
  statusTone,
  clientFacingStatus,
  type LiftVideo,
} from "@/lib/lift-videos";
import { ArrowLeft, Camera, CheckCircle2, Image as ImageIcon, MessageSquare, Video } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  role: "admin" | "client";
  clientName?: string | null;
  clientAvatarPath?: string | null;
};

function mediaLabel(v: LiftVideo) {
  if ((v.file_type ?? "").startsWith("image/")) return "Photo";
  return "Video";
}

export function LiftReviewMessageSheet({
  open,
  onOpenChange,
  clientId,
  role,
  clientName,
  clientAvatarPath,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const queryKey = ["message-lift-reviews", clientId];
  const { data: videos = [], isLoading } = useQuery({
    queryKey,
    enabled: open && !!clientId,
    queryFn: () => listLiftVideos({ clientId }),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!open || !clientId) return;
    const ch = supabase
      .channel(`message-lift-reviews:${clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lift_videos", filter: `client_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lift_video_comments", filter: `client_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [open, clientId, qc]);

  useEffect(() => {
    if (!open) setActiveId(null);
  }, [open]);

  const sorted = useMemo(() => {
    const rank = (v: LiftVideo) => {
      if (v.status === "New Upload" || v.status === "Awaiting Review") return 0;
      if (v.status === "Watched" || v.status === "Commented" || v.status === "Needs Follow-Up") return 1;
      if (v.status === "Reviewed") return 2;
      return 3;
    };
    return [...videos].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (role === "admin" && r !== 0) return r;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [videos, role]);

  const active = activeId ? videos.find((v) => v.id === activeId) ?? null : null;
  const pendingCount = videos.filter((v) =>
    v.status !== "Reviewed" && v.status !== "Archived"
  ).length;

  const refresh = () => qc.invalidateQueries({ queryKey });

  const openItem = async (v: LiftVideo) => {
    setActiveId(v.id);
    if (role === "client" && v.reviewed_at) {
      markClientViewed(v.id).catch(() => {});
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="z-[90] flex max-h-[94svh] min-h-[70svh] flex-col rounded-t-3xl p-0"
      >
        <div className="border-b border-border/70 bg-background/95 px-4 pb-3 pt-4 backdrop-blur sm:px-5">
          <SheetHeader className="text-left">
            <div className="flex items-center gap-2">
              {active && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-ml-2 h-8 w-8 rounded-full"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to lift reviews"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <div className="min-w-0">
                <SheetTitle className="flex items-center gap-2 text-lg font-black">
                  <Video className="h-5 w-5 text-primary" />
                  {active
                    ? "Lift Review"
                    : role === "client"
                      ? "Send a Lift for Review"
                      : `Lift Reviews${clientName ? ` · ${clientName}` : ""}`}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-xs">
                  {role === "client"
                    ? "Send a video or photo here. Your coach can reply directly to each item."
                    : "Open a lift, watch or view it, then reply directly underneath it."}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {active ? (
            <LiftVideoCard
              video={active}
              role={role}
              userId={user?.id ?? null}
              onChanged={refresh}
              clientName={clientName}
              clientAvatarPath={clientAvatarPath}
            />
          ) : (
            <div className="mx-auto w-full max-w-2xl space-y-4 pb-8">
              {role === "client" && (
                <ClientLiftVideoUploader
                  clientId={clientId}
                  clientName={clientName}
                  userId={user?.id ?? null}
                  onSaved={refresh}
                />
              )}

              <div className="flex items-center justify-between gap-2 px-1">
                <div>
                  <div className="text-sm font-bold">
                    {role === "client" ? "Your review requests" : "Client lift reviews"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {videos.length === 0
                      ? "No lift reviews yet"
                      : role === "admin"
                        ? `${pendingCount} waiting · ${videos.length} total`
                        : `${videos.length} submitted`}
                  </div>
                </div>
                {pendingCount > 0 && (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    {pendingCount} pending
                  </Badge>
                )}
              </div>

              {isLoading ? (
                <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  Loading lift reviews…
                </div>
              ) : sorted.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
                  <Camera className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <div className="text-sm font-semibold">No lifts submitted yet</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {role === "client"
                      ? "Use the uploader above to send the first one."
                      : "This client has not sent anything for review yet."}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sorted.map((v) => {
                    const isImage = (v.file_type ?? "").startsWith("image/");
                    const displayStatus = role === "client" ? clientFacingStatus(v) : v.status;
                    const note = v.client_notes?.trim() || v.question_for_coach?.trim();
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => openItem(v)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-secondary/20 active:scale-[0.995]"
                      >
                        <div className="grid h-14 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary">
                          {v.thumbnail_url ? (
                            <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : isImage ? (
                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <Video className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">
                              {v.exercise || `${mediaLabel(v)} for review`}
                            </span>
                            {v.is_urgent && (
                              <span className="shrink-0 text-[10px] font-bold uppercase text-destructive">Urgent</span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {note || "No note"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", statusTone(v.status))}>
                              {displayStatus}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}
                            </span>
                            {v.reviewed_at && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600">
                                <CheckCircle2 className="h-3 w-3" /> feedback
                              </span>
                            )}
                          </div>
                        </div>
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
