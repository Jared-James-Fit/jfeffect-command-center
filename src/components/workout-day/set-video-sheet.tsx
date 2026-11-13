/**
 * A set's videos, opened from its video cell (lazy): each clip plays where
 * it is, says it's in the coach chat (a tap opens the chat), saves to the
 * phone (Save to Photos), and can come off the set (and the chat with it). A
 * clip filmed in the app and never saved says so before it's removed, with
 * Save to Photos first: removing it would leave it nowhere. A clip on its
 * way shows how far it's got, with Try again / Cancel when it didn't send.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, MessageCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ChatVideoTile } from "@/components/chat-video-tile";
import { useChatSignedUrls } from "@/hooks/use-chat-signed-urls";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { isActiveJob, jobStatusText, type SetVideoJob } from "@/lib/set-videos/jobs";
import { setVideosKey, type SetVideo } from "@/components/workout-day/set-video-cell";
import { filmedFile, forgetFilmed, useUnsavedFilmed } from "@/lib/set-videos/phone-copy";
import {
  dismissPhoneCopyOffer,
  isUnsavedFilmed,
  jobIdForSetVideo,
  phoneSaveWords,
  useSaveSetVideos,
  type SetVideoSaveTarget,
} from "@/components/workout-day/set-video-phone-copy";

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
  const unsaved = useUnsavedFilmed(user?.id);
  const { save, warm } = useSaveSetVideos();
  const words = phoneSaveWords();
  const targetOf = (v: SetVideo): SetVideoSaveTarget => ({
    jobId: jobIdForSetVideo(v.id, unsaved),
    setVideoId: v.id,
    path: v.storage_path || null,
    name: `${exerciseName} set ${setIndex}`,
  });

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
      // let go of on purpose: stop offering it for the phone
      dismissPhoneCopyOffer(jobIdForSetVideo(v.id, unsaved));
      if (user?.id) forgetFilmed(user.id, { setVideoIds: [v.id] });
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
                  {filmedFile(j.id) && unsaved.some((e) => e.jobId === j.id) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-10 gap-1.5"
                      onPointerDown={() => warm([{ jobId: j.id, name: `${exerciseName} set ${setIndex}` }])}
                      onClick={() => save([{ jobId: j.id, name: `${exerciseName} set ${setIndex}` }])}
                    >
                      <ArrowDownToLine className="h-4 w-4" /> {words.label}
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
            // filmed in the app on this login and never saved to the phone
            const onlyHere = mine && isUnsavedFilmed(v.id, unsaved);
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
                  {v.storage_path && confirming !== v.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-10 shrink-0 gap-1.5 text-muted-foreground"
                      data-set-video-save
                      onPointerDown={() => warm([targetOf(v)])}
                      onClick={() => save([targetOf(v)])}
                    >
                      <ArrowDownToLine className="h-4 w-4" /> {words.label}
                    </Button>
                  )}
                  {canRemove &&
                    (confirming === v.id ? (
                      onlyHere ? null : (
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
                      )
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
                {canRemove && confirming === v.id && onlyHere && (
                  // filmed in the app and never saved: removing it would leave it nowhere
                  <div className="rounded-xl border border-border bg-muted/40 p-3" data-set-video-only-copy>
                    <p className="text-sm font-semibold">This video isn't {words.place}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      You filmed it in the app. Removing it takes it off the set and out of your coach's chat, and it won't be anywhere else.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10 gap-1.5"
                        onPointerDown={() => warm([targetOf(v)])}
                        onClick={() => save([targetOf(v)])}
                      >
                        <ArrowDownToLine className="h-4 w-4" /> {words.label}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-10"
                        onClick={() => void remove(v)}
                        disabled={removing === v.id}
                      >
                        {removing === v.id ? "Removing…" : "Remove anyway"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-10"
                        onClick={() => setConfirming(null)}
                        disabled={removing === v.id}
                      >
                        Keep
                      </Button>
                    </div>
                  </div>
                )}
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
