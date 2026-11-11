/**
 * A set's videos, opened from its video cell (lazy): each clip plays where
 * it is, says it's in the coach chat (a tap opens the chat), and can come
 * off the set (and the chat with it). A clip on its way shows how far it's
 * got, with Try again / Cancel when it didn't send.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChatVideoTile } from "@/components/chat-video-tile";
import { useChatSignedUrls } from "@/hooks/use-chat-signed-urls";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { isActiveJob, jobStatusText, type SetVideoJob } from "@/lib/set-videos/jobs";
import { setVideosKey, type SetVideo } from "@/components/workout-day/set-video-cell";

export default function SetVideoSheet({
  open,
  onOpenChange,
  dayId,
  clientId,
  exerciseName,
  setIndex,
  label,
  videos,
  jobs,
  canAdd,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayId: string;
  clientId: string;
  exerciseName: string;
  setIndex: number;
  label: string;
  videos: SetVideo[];
  jobs: SetVideoJob[];
  canAdd: boolean;
  onAdd: () => void;
}) {
  const { user, role } = useAuth();
  const staff = role === "admin" || role === "coach";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const paths = videos.flatMap(
    (v) => [v.storage_path, v.thumbnail_path].filter(Boolean) as string[],
  );
  const { urls } = useChatSignedUrls(paths);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const openChat = () => {
    onOpenChange(false);
    if (staff) void navigate({ to: "/admin/messages", search: { client: clientId } });
    else void navigate({ to: "/portal/messages" });
  };

  const remove = async (v: SetVideo) => {
    setRemoving(v.id);
    try {
      const { error } = await (supabase as any).rpc("set_video_remove", { _id: v.id });
      if (error) throw error;
      qc.setQueryData<SetVideo[]>(setVideosKey(dayId), (cur) =>
        (cur ?? []).filter((x) => x.id !== v.id),
      );
      void qc.invalidateQueries({ queryKey: setVideosKey(dayId) });
      void qc.invalidateQueries({ queryKey: ["messages"] });
      toast.success("Video removed from the set and the chat");
      if (videos.length <= 1 && !jobs.length) onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't remove it. Try again.");
    } finally {
      setRemoving(null);
      setConfirming(null);
    }
  };

  const uploader = () => import("@/lib/set-videos/uploader");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[520px]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="flex items-start gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-base font-semibold">
              {exerciseName} · Set {setIndex}
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {label || "Set video"}
            </SheetDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="-mr-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-4 pb-3">
          {jobs.map((j) => {
            const active = isActiveJob(j);
            return (
              <div
                key={j.id}
                className="rounded-xl border border-border p-3"
                data-set-video-job={j.state}
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span
                    className={cn(
                      "min-w-0",
                      j.state === "failed" && !j.autoRetry && "text-destructive",
                    )}
                  >
                    {jobStatusText(j)}
                  </span>
                  {active && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(j.progress)}%
                    </span>
                  )}
                </div>
                {active && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground transition-[width] duration-300"
                      style={{ width: `${Math.max(3, Math.min(100, j.progress))}%` }}
                    />
                  </div>
                )}
                {active && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Keep logging. It sends in the background, and carries on if you leave the app.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {j.state === "failed" && !j.needsFile && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10"
                      onClick={() => void uploader().then((m) => m.retrySetVideo(j.id))}
                    >
                      <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
                    </Button>
                  )}
                  {j.state === "failed" && j.needsFile && canAdd && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10"
                      onClick={() => {
                        void uploader().then((m) => m.cancelSetVideo(j.id));
                        onAdd();
                      }}
                    >
                      Pick the video again
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-10 text-muted-foreground"
                    onClick={() => void uploader().then((m) => m.cancelSetVideo(j.id))}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })}

          {videos.map((v) => {
            const mine = v.uploaded_by === user?.id;
            const canRemove = mine || !staff || role === "admin";
            return (
              <div key={v.id} className="space-y-2" data-set-video-id={v.id}>
                <ChatVideoTile
                  src={urls[v.storage_path]}
                  poster={v.thumbnail_path ? urls[v.thumbnail_path] : undefined}
                  expectPoster={!!v.thumbnail_path}
                  width={v.width ?? undefined}
                  height={v.height ?? undefined}
                  duration={v.duration_s ?? undefined}
                  cacheKey={v.storage_path}
                  path={v.storage_path}
                  size={v.size_bytes ?? undefined}
                  name={`${exerciseName} set ${setIndex}`}
                  className="mx-auto w-[220px]"
                />
                <div className="flex items-center gap-2">
                  {v.message_id ? (
                    <button
                      type="button"
                      onClick={openChat}
                      className="inline-flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-left text-sm text-muted-foreground hover:text-foreground"
                    >
                      <MessageCircle className="h-4 w-4 shrink-0 text-success" />
                      <span className="truncate">
                        {staff ? "In the coach chat" : "Sent to your coach · open chat"}
                      </span>
                    </button>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">On this set</span>
                  )}
                  {canRemove &&
                    (confirming === v.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-10"
                          onClick={() => setConfirming(null)}
                          disabled={removing === v.id}
                        >
                          Keep
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-10"
                          onClick={() => void remove(v)}
                          disabled={removing === v.id}
                        >
                          {removing === v.id ? "Removing…" : "Remove from set and chat"}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10 shrink-0 text-muted-foreground"
                        onClick={() => setConfirming(v.id)}
                        aria-label="Remove this video"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ))}
                </div>
              </div>
            );
          })}

          {canAdd && (
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => {
                onAdd();
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add another video
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
