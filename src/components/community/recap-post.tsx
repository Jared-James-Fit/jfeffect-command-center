import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, ChevronRight, Loader2, PenSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isCrewAudience, postPointsHint } from "@/lib/community";
import { invalidateCommunity, saveCommunityPost, useCommunityActivity, useDeletePost, useMyPostForCompletion, usePostPointsStatus } from "@/lib/community.queries";
import { storyLookLabel } from "@/lib/quick-story";
import { QuickStorySheet, QuickStoryThumb, useQuickStory } from "@/components/community/quick-story";

/**
 * The recap's footer for a finished client workout: where the workout is now
 * and the two ways to share it, kept apart.
 *
 * Story is the quick share: the story is painted for them already (the
 * workout's own numbers, its best look first: a PR leads with the record),
 * shown right here small, and one tap on Share to Story posts it (24 hours,
 * the story rail only). A tap on the preview opens it big to change the look,
 * put one photo under it, add a line of words or keep it to Close friends.
 * Nothing goes up until they tap Share, and Undo takes it back.
 *
 * Crew is the considered post: Create Crew Post opens the full studio (photos
 * and clips, the carousel, captions, GIF, voice memo, who sees it), carrying
 * the workout and any words they wrote; posting there is what earns the
 * League's post points, as before. Done always closes.
 *
 * Finishing no longer posts a story by itself unless they switched automatic
 * stories on (Privacy); when it did, this says so with Hide it, and a story
 * they make here takes its place.
 */
export function RecapPostFooter({
  completionId,
  completedAt,
  unit = "lb",
  workoutTitle,
  athleteName,
  onDone,
  onStudio,
}: {
  completionId: string;
  completedAt?: string | Date | null;
  unit?: "kg" | "lb";
  workoutTitle?: string | null;
  athleteName?: string | null;
  onDone: () => void;
  /** Opens the full studio for a Crew post, carrying any words written for the story. */
  onStudio: (caption: string) => void;
}) {
  const qc = useQueryClient();
  const { data: activity } = useCommunityActivity(true);
  const { data: existing } = useMyPostForCompletion(completionId);
  // Their lock-in for this session (a separate post): it carries the numbers until the finish is posted.
  const { data: lockIn } = useMyPostForCompletion(completionId, true, "lockin");
  const canPost = activity?.enabled !== false;
  const story = useQuickStory({ completionId, workoutTitle, athleteName, unit, enabled: canPost });
  const [editing, setEditing] = useState(false);
  // the story shared from here (Undo takes it back)
  const [storyId, setStoryId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  // the automatic story, hidden from here (only them now)
  const [hiddenHere, setHiddenHere] = useState(false);
  const [hiding, setHiding] = useState(false);
  const busy = useRef(false);
  const del = useDeletePost();

  const auto = !!existing?.auto_shared;
  const autoUp = auto && !hiddenHere && isCrewAudience(existing?.visibility);
  const hidden = hiddenHere || (auto && existing?.visibility === "private");
  // their own feed post for this session (made in the studio, or by their film)
  const inFeed = !!existing && !auto && isCrewAudience(existing.visibility);
  const { data: points } = usePostPointsStatus(canPost && !inFeed);
  const hint = postPointsHint(points, "community", inFeed, { completedAt: completedAt ? new Date(completedAt).toISOString() : null });
  const earn = hint?.tone === "earn" && points ? points.points : 0;

  // Take the automatic story out of Crew: only they can see it (their profile).
  const hideAuto = async (quiet = false) => {
    if (busy.current) return;
    busy.current = true;
    setHiding(true);
    try {
      await saveCommunityPost({ completionId, caption: "", visibility: "private", media: { action: "keep" } });
      setHiddenHere(true);
      invalidateCommunity(qc);
    } catch (e: any) {
      if (!quiet) toast.error(e?.message ?? "Couldn't hide it. Try again.");
    } finally {
      busy.current = false;
      setHiding(false);
    }
  };

  const shareStory = async () => {
    const replaces = autoUp;
    const id = await story.share();
    if (!id) return;
    setStoryId(id);
    setEditing(false);
    // the automatic story from this workout gives way to the one they made (never two of the same session)
    if (replaces) await hideAuto(true);
    toast.success(story.audience === "close_friends" ? "Added to your Close friends story" : "Added to your story", { description: "It's in the story row for 24 hours." });
  };

  const undoStory = async () => {
    const id = storyId;
    if (!id || undoing) return;
    setUndoing(true);
    try {
      // its picture goes with it
      const { data } = await supabase.from("community_posts").select("media_path, media_thumb_path").eq("id", id).maybeSingle();
      await del.mutateAsync({ id, media_path: data?.media_path ?? null, media_thumb_path: data?.media_thumb_path ?? null, is_mine: true });
      setStoryId(null);
      toast("Taken off your story");
    } catch {
      toast.error("Couldn't take it down. Delete it from your story.");
    } finally {
      setUndoing(false);
    }
  };

  if (!canPost) {
    // No community on this account: the studio still makes a story / sends it to the coach.
    return (
      <div className="grid w-full grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-12 rounded-lg text-sm font-semibold" onClick={() => onStudio("")}>
          <Camera className="mr-1.5 h-4 w-4" />
          Share
        </Button>
        <Button type="button" className="h-12 rounded-lg text-sm font-semibold" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const lookName = story.look ? storyLookLabel(story.look, !!story.photo) : null;
  return (
    <div className="w-full" data-recap-composer>
      {lockIn && <div className="mb-1.5 text-center text-[12px] text-muted-foreground">🔒 Your lock-in stays up. This shares the finish.</div>}
      {/* what's already out there, said once */}
      {(inFeed || autoUp || hidden) && (
        <p className="mb-2 text-center text-[12px] text-muted-foreground" data-recap-status={inFeed ? "feed" : autoUp ? "auto" : "hidden"}>
          {inFeed ? (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <Check className="h-3.5 w-3.5" strokeWidth={3} /> In the Crew feed
            </span>
          ) : autoUp ? (
            <>
              Posted to your story automatically ·{" "}
              <button type="button" onClick={() => void hideAuto()} disabled={hiding} className="font-semibold text-foreground underline underline-offset-2 active:opacity-60">
                {hiding ? "Hiding…" : "Hide it"}
              </button>
            </>
          ) : (
            "Hidden from Crew. Only you can see this session."
          )}
        </p>
      )}

      {/* the story: painted already, one tap to post it, a tap on it to change it */}
      <div className="mb-2 flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-2" data-recap-story={storyId ? "shared" : "ready"}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={!!storyId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left active:opacity-70 disabled:active:opacity-100"
          aria-label={storyId ? "Your story" : "Edit your story: look, photo, words"}
        >
          <QuickStoryThumb story={story} className="h-[76px] shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight">{storyId ? "On your story" : "Your story"}</span>
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {storyId ? (story.audience === "close_friends" ? "Close friends · 24 hours" : "Crew · 24 hours") : story.ready ? `${lookName} look` : "Getting it ready…"}
            </span>
            {!storyId && (
              <span className="mt-1 inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-medium text-foreground" data-recap-story-edit>
                Tap to edit <ChevronRight className="h-3.5 w-3.5" />
              </span>
            )}
          </span>
        </button>
        {storyId ? (
          <Button type="button" variant="outline" className="h-10 shrink-0 rounded-lg px-3 text-[13px] font-semibold" onClick={() => void undoStory()} disabled={undoing} data-recap-story-undo>
            {undoing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Undo"}
          </Button>
        ) : (
          <Button type="button" className="h-11 shrink-0 rounded-lg px-3.5 text-[14px] font-semibold" onClick={() => void shareStory()} disabled={!story.ready || story.busy} data-recap-share-story>
            {story.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Share to Story"}
          </Button>
        )}
      </div>

      <div className="grid w-full grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-11 flex-col gap-0 rounded-lg leading-tight" onClick={() => onStudio(story.caption.trim())} data-recap-crew-post>
          <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold">
            <PenSquare className="h-4 w-4" />
            {inFeed ? "Edit Crew post" : "Create Crew Post"}
          </span>
          {earn > 0 && <span className="text-[11px] font-medium text-muted-foreground">+{earn} league points</span>}
        </Button>
        <Button type="button" variant={storyId || inFeed ? "default" : "secondary"} className="h-11 rounded-lg text-[14px] font-semibold" onClick={onDone} data-recap-done>
          Done
        </Button>
      </div>

      <QuickStorySheet
        open={editing}
        onClose={() => setEditing(false)}
        story={story}
        onShare={() => void shareStory()}
        onVideo={() => {
          setEditing(false);
          onStudio(story.caption.trim());
        }}
      />
    </div>
  );
}
