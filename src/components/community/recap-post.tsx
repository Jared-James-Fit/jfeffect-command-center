import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Flame, PenLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CAPTION_MAX, isCrewAudience, pickWorkoutWin, postPointsHint, type WorkoutShareStats } from "@/lib/community";
import { WIN_STYLE } from "@/components/community/pulse-style";
import { MentionSuggestBar } from "@/components/community/mentions";
import {
  invalidateCommunity,
  saveCommunityPost,
  useCommunityActivity,
  useCompletionPreview,
  useDeletePost,
  useMyPostForCompletion,
  usePostPointsStatus,
} from "@/lib/community.queries";

/**
 * The recap's footer for a finished client workout: the moment they're
 * proudest, so sharing it is one tap, and it's where they see what they'd
 * share. A compact composer: the session's headline win (the same one its
 * Crew post leads with, from the same stats), a caption (optional; the
 * coach's note from the review never goes in it) and the camera (the full
 * studio: photo, looks, who sees it), then Share to Crew with what it earns.
 *
 * Finishing already posts the session to their story by itself (a Pulse,
 * when automatic sharing is on: 24 hours, never the feed), so that post isn't
 * "shared" yet: Share to Crew turns that same post into theirs in the feed
 * (community_save_post upserts the session's one post, so it's never a
 * duplicate), and "Hide it" takes this one out of Crew (only them). The
 * review is saved before this shows, so a failed share never touches it. A
 * lock-in is its own post, so this always posts the finish separately. Once
 * it's shared, it says where it is (with Undo right there when this made the
 * post) and Done takes over.
 */
export function RecapPostFooter({
  completionId,
  completedAt,
  unit = "lb",
  onDone,
  onStudio,
}: {
  completionId: string;
  completedAt?: string | Date | null;
  unit?: "kg" | "lb";
  onDone: () => void;
  /** Opens the studio, carrying the caption written here so far. */
  onStudio: (caption: string) => void;
}) {
  const qc = useQueryClient();
  const { data: activity } = useCommunityActivity(true);
  const { data: existing, isLoading } = useMyPostForCompletion(completionId);
  // Their lock-in for this session (a separate post): it carries the numbers until the finish is posted.
  const { data: lockIn } = useMyPostForCompletion(completionId, true, "lockin");
  // What the post will lead with: the same stats the feed shows.
  const { data: stats } = useCompletionPreview(completionId);
  const canPost = activity?.enabled !== false;
  // Hidden from this footer (only them now): still theirs to share.
  const [hiddenHere, setHiddenHere] = useState(false);
  const auto = !!existing?.auto_shared;
  const hidden = hiddenHere && existing?.visibility === "private";
  // The post made from this footer (it can be undone here). Set the moment the
  // share lands, so it reads as shared before the refetch catches up.
  const [justPosted, setJustPosted] = useState<string | null>(null);
  // Undo deletes the post, so it's offered only for one this made (never their
  // session's story post that sharing upgraded, which would go with it).
  const [undoable, setUndoable] = useState(false);
  // Not shared yet: nothing posted, the automatic story post, or one just hidden here.
  const unshared = !justPosted && (!existing || auto || hidden);
  const { data: points } = usePostPointsStatus(canPost && unshared);
  const hint = postPointsHint(points, "community", false, { completedAt: completedAt ? new Date(completedAt).toISOString() : null });
  const earn = hint?.tone === "earn" && points ? points.points : 0;
  const del = useDeletePost();
  const [posting, setPosting] = useState(false);
  const [hiding, setHiding] = useState(false);
  // one save at a time, even on a fast double tap (state lands a render late)
  const busy = useRef(false);
  const [caption, setCaption] = useState("");
  const [writing, setWriting] = useState(false);

  const post = async () => {
    if (busy.current) return;
    busy.current = true;
    setPosting(true);
    try {
      const made = !existing;
      const id = await saveCommunityPost({ completionId, caption: caption.trim(), visibility: "community", media: { action: "keep" } });
      setUndoable(made);
      setJustPosted(id);
      setHiddenHere(false);
      invalidateCommunity(qc);
      toast.success(`You're in the feed 🔥${earn ? ` +${earn} league points` : ""}`);
    } catch (e: any) {
      // the caption stays right here to try again; the review was already saved
      toast.error(e?.message ?? "Couldn't share that. Try again.");
    } finally {
      busy.current = false;
      setPosting(false);
    }
  };
  // Take the automatic story post out of Crew: only they can see it (their profile).
  const hide = async () => {
    if (busy.current) return;
    busy.current = true;
    setHiding(true);
    try {
      await saveCommunityPost({ completionId, caption: "", visibility: "private", media: { action: "keep" } });
      setHiddenHere(true);
      invalidateCommunity(qc);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't hide it. Try again.");
    } finally {
      busy.current = false;
      setHiding(false);
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

  if (!unshared) {
    const postId = justPosted ?? existing!.id;
    const where =
      justPosted || isCrewAudience(existing?.visibility)
        ? "It's in the crew's feed"
        : existing?.visibility === "coach"
          ? "Shared with your coach"
          : existing?.visibility === "close_friends"
            ? "Shared with your Close friends"
            : "Saved to your profile";
    return (
      <div className="w-full">
        <div className="mb-2 flex items-center justify-center gap-1.5 text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" strokeWidth={3} /> {where}
          {justPosted === postId && undoable && (
            <button type="button" onClick={() => undo(postId)} disabled={del.isPending} className="ml-1 rounded-full px-1.5 py-0.5 font-bold text-muted-foreground underline underline-offset-2 active:opacity-60">
              Undo
            </button>
          )}
        </div>
        <div className="grid w-full grid-cols-[1fr_1.35fr] gap-2">
          <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={() => onStudio("")}>
            <Camera className="mr-1.5 h-4 w-4" />
            {existing?.media_path ? "Edit post" : "Add a photo"}
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
    <div className="w-full" data-recap-composer>
      {lockIn && <div className="mb-1.5 text-center text-[11px] font-semibold text-muted-foreground">🔒 Your lock-in stays up. This shares the finish.</div>}
      {/* the post-to-be: what it leads with, the caption, the camera */}
      <div className="mb-2 overflow-hidden rounded-2xl border border-border/80 bg-card">
        <SharePreview stats={stats ?? null} unit={unit} hideLoads={!!existing?.hide_loads} onPhoto={() => onStudio(caption)} />
        <CaptionRow value={caption} onOpen={() => setWriting(true)} />
      </div>
      <div className="grid w-full grid-cols-[1fr_1.7fr] gap-2">
        <Button type="button" variant="outline" className="h-12 rounded-xl text-sm font-bold" onClick={onDone}>
          Done
        </Button>
        <Button
          type="button"
          data-recap-post
          className="h-12 flex-col gap-0 rounded-xl leading-tight shadow-md shadow-primary/25"
          disabled={posting || hiding || isLoading}
          onClick={() => void post()}
        >
          <span className="inline-flex items-center gap-1 text-sm font-black">
            <Flame className="h-4 w-4" /> {posting ? "Sharing…" : "Share to Crew"}
          </span>
          {earn > 0 && <span className="text-[10px] font-bold opacity-90">+{earn} league points</span>}
        </Button>
      </div>
      {/* where it is now, honestly: finishing already put it in their story */}
      {auto && !hidden && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground" data-recap-status="auto">
          On your story for 24 hours ·{" "}
          <button type="button" onClick={() => void hide()} disabled={hiding} className="font-semibold underline underline-offset-2 active:opacity-60">
            {hiding ? "Hiding…" : "Hide it"}
          </button>
        </p>
      )}
      {hidden && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground" data-recap-status="hidden">
          Hidden from Crew. Only you can see this session.
        </p>
      )}
      <CaptionSheet open={writing} value={caption} onChange={setCaption} onDone={() => setWriting(false)} />
    </div>
  );
}

/**
 * What the crew will see first: the session's headline win (a PR, a
 * milestone, a streak, the top set, or "session done"), the same one its post
 * and story lead with. The camera sits right on it.
 */
function SharePreview({ stats, unit, hideLoads, onPhoto }: { stats: WorkoutShareStats | null; unit: "kg" | "lb"; hideLoads: boolean; onPhoto: () => void }) {
  const win = stats ? pickWorkoutWin(stats, unit) : null;
  const style = WIN_STYLE[win?.kind ?? "done"];
  // weights hidden on their posts: never on the preview either
  const detail = win?.detail && !hideLoads ? win.detail : null;
  return (
    <div className={cn("flex items-center gap-3 bg-[#0b0b0e] px-3.5 py-3 text-white", style.tint)} data-recap-preview={win?.kind ?? "loading"}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10", style.text)}>
        <style.Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[10px] font-black uppercase tracking-[0.16em]", style.text)}>{win ? win.label : "Your workout"}</span>
        {win ? (
          // a long lift name gives way, the numbers never do
          <span className="font-display flex min-w-0 text-[19px] uppercase leading-tight">
            <span className="truncate">{win.headline}</span>
            {detail && <span className="shrink-0 whitespace-pre text-white/75"> · {detail}</span>}
          </span>
        ) : (
          <span className="mt-1 block h-4 w-40 animate-pulse rounded bg-white/15" />
        )}
      </span>
      <button type="button" onClick={onPhoto} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 active:scale-95" aria-label="Share with a photo">
        <Camera className="h-5 w-5" />
      </button>
    </div>
  );
}

/** The caption, folded: what they wrote (two lines), or the prompt to write one. */
function CaptionRow({ value, onOpen }: { value: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[14px] leading-snug active:bg-muted"
      aria-label={value.trim() ? "Edit caption" : "Write a caption"}
    >
      <PenLine className="h-4 w-4 shrink-0 text-muted-foreground" />
      {value.trim() ? (
        <span className="min-w-0 line-clamp-2 whitespace-pre-wrap break-words">{value.trim()}</span>
      ) : (
        <span className="text-muted-foreground">Say something about it (optional)</span>
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
            <SheetDescription className="text-[12px]">Goes on your Crew post. Your review and coach note stay private.</SheetDescription>
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
