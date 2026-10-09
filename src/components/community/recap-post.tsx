import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Flame } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { postPointsHint } from "@/lib/community";
import { CrewGoalAfterWorkout } from "@/components/community/crew-goal";
import {
  invalidateCommunity,
  saveCommunityPost,
  useCommunityActivity,
  useDeletePost,
  useMyPostForCompletion,
  usePostPointsStatus,
} from "@/lib/community.queries";

/**
 * The recap's footer for a finished client workout. It's the moment they're
 * proudest, so posting is one tap: "Post to crew" puts the workout card in
 * the feed (no caption needed) and says what it earns; Undo sits right in
 * the footer (a toast's button is under the recap). The camera opens the
 * full studio (photo, looks, caption, who sees it). Once there's a post (or
 * they locked in), it says where it is and Done takes over.
 */
export function RecapPostFooter({
  completionId,
  completedAt,
  onDone,
  onStudio,
}: {
  completionId: string;
  completedAt?: string | Date | null;
  onDone: () => void;
  onStudio: () => void;
}) {
  const qc = useQueryClient();
  const { data: activity } = useCommunityActivity(true);
  const { data: existing, isLoading } = useMyPostForCompletion(completionId);
  const canPost = activity?.enabled !== false;
  const { data: points } = usePostPointsStatus(canPost && !existing);
  const hint = postPointsHint(points, "community", false, { completedAt: completedAt ? new Date(completedAt).toISOString() : null });
  const earn = hint?.tone === "earn" && points ? points.points : 0;
  const del = useDeletePost();
  const [posting, setPosting] = useState(false);
  // The post made from this footer (it can be undone here).
  const [justPosted, setJustPosted] = useState<string | null>(null);

  const post = async () => {
    setPosting(true);
    try {
      const id = await saveCommunityPost({ completionId, caption: "", visibility: "community", media: { action: "keep" } });
      setJustPosted(id);
      invalidateCommunity(qc);
      toast.success(`You're in the feed 🔥${earn ? ` +${earn} league points` : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't post that");
    } finally {
      setPosting(false);
    }
  };
  const undo = (id: string) =>
    del.mutate(
      { id, media_path: null, media_thumb_path: null, extra_media: null, is_mine: true },
      {
        onSuccess: () => {
          setJustPosted(null);
          toast("Post removed");
        },
        onError: () => toast.error("Couldn't remove it. Delete it from the feed."),
      },
    );

  if (existing) {
    const where =
      existing.visibility === "community"
        ? existing.locked_in_at
          ? "Your lock-in now has your numbers"
          : "It's in the crew's feed"
        : existing.visibility === "coach"
          ? "Shared with your coach"
          : "Saved to your profile";
    return (
      <div className="w-full">
        {canPost && <CrewGoalAfterWorkout className="mb-2.5" />}
        <div className="mb-2 flex items-center justify-center gap-1.5 text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" strokeWidth={3} /> {where}
          {justPosted === existing.id && (
            <button type="button" onClick={() => undo(existing.id)} disabled={del.isPending} className="ml-1 rounded-full px-1.5 py-0.5 font-bold text-muted-foreground underline underline-offset-2 active:opacity-60">
              Undo
            </button>
          )}
        </div>
        <div className="grid w-full grid-cols-[1fr_1.35fr] gap-2">
          <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={onStudio}>
            <Camera className="mr-1.5 h-4 w-4" />
            {existing.media_path ? "Edit post" : "Add a photo"}
          </Button>
          <Button type="button" className="h-12 rounded-xl text-sm font-black" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (!canPost) {
    // No community on this account: the studio still makes a story / sends it to the coach.
    return (
      <div className="grid w-full grid-cols-[1fr_1.35fr] gap-2">
        <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={onStudio}>
          <Camera className="mr-1.5 h-4 w-4" />
          Share
        </Button>
        <Button type="button" className="h-12 rounded-xl text-sm font-black" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full">
    <CrewGoalAfterWorkout className="mb-2.5" />
    <div className="grid w-full grid-cols-[1fr_auto_1.5fr] gap-2">
      <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={onDone}>
        Done
      </Button>
      <Button type="button" variant="outline" className="h-12 w-12 rounded-xl px-0" onClick={onStudio} aria-label="Post with a photo">
        <Camera className="h-5 w-5" />
      </Button>
      <Button
        type="button"
        data-recap-post
        className="h-12 flex-col gap-0 rounded-xl leading-tight shadow-md shadow-primary/25"
        disabled={posting || isLoading}
        onClick={() => void post()}
      >
        <span className="inline-flex items-center gap-1 text-sm font-black">
          <Flame className="h-4 w-4" /> {posting ? "Posting…" : "Post to crew"}
        </span>
        {earn > 0 && <span className="text-[10px] font-bold opacity-90">+{earn} league points</span>}
      </Button>
    </div>
    </div>
  );
}
