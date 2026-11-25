import { useEffect, useState } from "react";
import { ChevronRight, LayoutGrid, Loader2, Sticker as StickerIcon } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { PREVIEW_ONLY_MESSAGE, type CommunityPost } from "@/lib/community";
import { storyFeedVerdict } from "@/lib/story-feed";
import { useShareStoryToFeed } from "@/lib/story-feed.queries";
import { feedback } from "@/lib/feedback";

/**
 * The ⋯ on your own story (Instagram's): the things you do with the story
 * itself, kept out of the viewer's bar. Share to feed puts a copy of it in
 * the feed on your say-so (a story never becomes a post by itself); Change
 * sticker edits the poll, slider or question you put on it in the studio.
 * Each row says why when it can't be used. The story waits while this is open.
 */
export function StoryMenuSheet({ post, open, onClose, onEditSticker, onViewFeedPost, onHold, link }: {
  post: CommunityPost;
  open: boolean;
  onClose: () => void;
  onEditSticker?: () => void;
  /** The one page a story keeps a link to (storyLinkLabel): its workout, or the post it shares. */
  link?: { label: string; onOpen: () => void } | null;
  /** Opens the new feed post (the toast's View). */
  onViewFeedPost?: (id: string) => void;
  /** Tells the story to wait while this is up (the menu, or its confirmation). */
  onHold: (on: boolean) => void;
}) {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const share = useShareStoryToFeed(user?.id);
  const [asking, setAsking] = useState(false);
  const verdict = storyFeedVerdict(post);
  useEffect(() => {
    onHold(open || asking);
  }, [open, asking, onHold]);

  const ask = () => {
    if (isImpersonating) return void toast.message(PREVIEW_ONLY_MESSAGE);
    if (!verdict.ok) return void toast.message(verdict.reason);
    onClose();
    setAsking(true);
  };
  const run = () => {
    setAsking(false);
    feedback("tap");
    share.mutate(post, {
      onSuccess: (id) => {
        feedback("post");
        toast.success("Shared to your feed", onViewFeedPost ? { action: { label: "View", onClick: () => onViewFeedPost(id) } } : undefined);
      },
      onError: (e: any) => toast.error(e?.message ?? "That didn't post. Try again."),
    });
  };
  const who = verdict.ok && verdict.audience === "followers" ? "your followers" : "the crew";
  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" swipeToClose hideCloseButton overlayClassName="bg-black/40" className="mx-auto max-w-lg gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),12px)]" data-story-menu>
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetTitle className="sr-only">Your story</SheetTitle>
          <SheetDescription className="sr-only">Share this story to your feed, or change its sticker</SheetDescription>
          <ul className="px-2 pb-1 pt-3">
            <li>
              <button type="button" onClick={ask} aria-disabled={!verdict.ok} className="flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left active:bg-muted aria-disabled:opacity-60" data-story-share-feed>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
                  {share.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LayoutGrid className="h-5 w-5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">Share to feed</span>
                  <span className="block text-[13px] leading-snug text-muted-foreground">{verdict.ok ? "Post a copy to the feed. Your story stays up." : verdict.reason}</span>
                </span>
              </button>
            </li>
            {link && (
              <li>
                <button type="button" onClick={() => { onClose(); window.setTimeout(link.onOpen, 120); }} className="flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left active:bg-muted" data-story-menu-link>
                  <span className="min-w-0 flex-1 text-[15px] font-semibold">{link.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            )}
            {onEditSticker && (
              <li>
                <button type="button" onClick={() => { onClose(); window.setTimeout(onEditSticker, 120); }} className="flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left active:bg-muted" data-story-edit-sticker>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted"><StickerIcon className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">Change sticker</span>
                    <span className="block text-[13px] leading-snug text-muted-foreground">Edit or remove the poll, slider or question.</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </SheetContent>
      </Sheet>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share to your feed?</AlertDialogTitle>
            <AlertDialogDescription>
              {`A copy of this story, with the same picture and words, goes to the feed for ${who}. Your story stays up for its 24 hours. A poll, slider or question stays on the story only.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Share</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
