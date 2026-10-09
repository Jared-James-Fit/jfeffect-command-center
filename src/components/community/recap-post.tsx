import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Flame, PenLine, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_MAX, postPointsHint } from "@/lib/community";
import { MentionSuggestBar } from "@/components/community/mentions";
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
 * the feed and says what it earns; the caption sits right above it (optional,
 * and it rides into the studio if they open the camera instead). Undo sits
 * right in the footer (a toast's button is under the recap). The camera opens
 * the full studio (photo, looks, caption, who sees it). A lock-in is its own
 * post, so this always posts the finish separately. Once there's a finish
 * post, it says where it is and Done takes over.
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
  /** Opens the studio, carrying the caption written here so far. */
  onStudio: (caption: string) => void;
}) {
  const qc = useQueryClient();
  const { data: activity } = useCommunityActivity(true);
  const { data: existing, isLoading } = useMyPostForCompletion(completionId);
  // Their lock-in for this session (a separate post): it carries the numbers until the finish is posted.
  const { data: lockIn } = useMyPostForCompletion(completionId, true, "lockin");
  const canPost = activity?.enabled !== false;
  const { data: points } = usePostPointsStatus(canPost && !existing);
  const hint = postPointsHint(points, "community", false, { completedAt: completedAt ? new Date(completedAt).toISOString() : null });
  const earn = hint?.tone === "earn" && points ? points.points : 0;
  const del = useDeletePost();
  const [posting, setPosting] = useState(false);
  // The post made from this footer (it can be undone here).
  const [justPosted, setJustPosted] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [writing, setWriting] = useState(false);

  const post = async () => {
    setPosting(true);
    try {
      const id = await saveCommunityPost({ completionId, caption: caption.trim(), visibility: "community", media: { action: "keep" } });
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
        ? "It's in the crew's feed"
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
          <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={() => onStudio("")}>
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
        <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={() => onStudio("")}>
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
    {lockIn && (
      <div className="mb-2 text-center text-[12px] font-semibold text-muted-foreground">🔒 Your lock-in stays up. This posts your finish on its own.</div>
    )}
    <CaptionRow value={caption} onOpen={() => setWriting(true)} />
    <div className="grid w-full grid-cols-[1fr_auto_1.5fr] gap-2">
      <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={onDone}>
        Done
      </Button>
      <Button type="button" variant="outline" className="h-12 w-12 rounded-xl px-0" onClick={() => onStudio(caption)} aria-label="Post with a photo">
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
    <CaptionSheet open={writing} value={caption} onChange={setCaption} onDone={() => setWriting(false)} />
    </div>
  );
}

/** The caption, folded: what they wrote (two lines), or the prompt to write one. */
function CaptionRow({ value, onOpen }: { value: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-2 flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-border/80 bg-muted/40 px-3.5 py-2.5 text-left text-[14px] leading-snug active:bg-muted"
      aria-label={value.trim() ? "Edit caption" : "Write a caption"}
    >
      <PenLine className="h-4 w-4 shrink-0 text-muted-foreground" />
      {value.trim() ? (
        <span className="min-w-0 line-clamp-2 whitespace-pre-wrap break-words">{value.trim()}</span>
      ) : (
        <span className="text-muted-foreground">Write a caption (optional)</span>
      )}
    </button>
  );
}

/** Writing it: a roomy box with @mentions, Done to go back to Post. */
function CaptionSheet({ open, value, onChange, onDone }: { open: boolean; value: string; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onDone()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const t = ref.current;
          if (t) {
            t.focus({ preventScroll: true });
            t.setSelectionRange(t.value.length, t.value.length);
          }
        }}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border/60 px-5 pb-3 pt-4 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] font-black">Caption</SheetTitle>
            <SheetDescription className="text-[12px]">Goes on your post with the workout card.</SheetDescription>
          </div>
          <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </SheetClose>
        </SheetHeader>
        <div className="px-5 py-4">
          <Textarea
            ref={ref}
            value={value}
            maxLength={CAPTION_MAX}
            onChange={(e) => onChange(e.target.value.slice(0, CAPTION_MAX))}
            placeholder="How'd it go?"
            // 16px+ keeps iOS from zooming in
            className="min-h-[110px] resize-none text-[16px]"
            aria-label="Caption"
          />
          <MentionSuggestBar value={value} onChange={(v) => onChange(v.slice(0, CAPTION_MAX))} inputRef={ref} className="mt-1" />
          <div className="mt-1 text-right text-[11px] text-muted-foreground">{value.length > 0 && `${value.length}/${CAPTION_MAX}`}</div>
        </div>
        <div className="border-t border-border/60 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          <Button type="button" className="h-12 w-full rounded-2xl text-[15px] font-black" onClick={onDone}>
            <Check className="mr-1.5 h-4 w-4" /> Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
