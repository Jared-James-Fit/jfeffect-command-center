import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { MentionText } from "@/components/community/mentions";
import { CommentThread } from "@/components/community/comments-sheet";
import { AutoPostCaption, CoachBadge } from "@/components/community/post-card";
import { LikedBy, ReactorsSheet } from "@/components/community/reactors-sheet";
import { WorkoutDetails } from "@/components/community/workout-details";
import { UserAvatar } from "@/components/user-avatar";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { isAutoPost, postTimeLabel, reactionTotal, withHandles, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { cn } from "@/lib/utils";
import { useSwipeDownToClose } from "@/hooks/use-swipe-down-to-close";
import { POST_SHEET_HEIGHT } from "@/lib/post-sheet";

/** Where the sheet opens: the caption at the top ("… more"), scrolled to the comments (💬), or a workout's every set (its recap). */
export type PostSheetAt = "caption" | "comments" | "workout";

/** A post whose sheet has a Workout tab: a finished workout someone shared (never a Pulse, an automated post or a coach's note). */
export function sheetHasWorkout(post: CommunityPost): boolean {
  return !!post.stats && !post.auto && !isAutoPost(post) && post.kind !== "note";
}

/**
 * A post's words and comments on the clients' paged Crew feed, Instagram's
 * and TikTok's way: a sheet over the bottom of the screen titled Comments
 * (✕ closes it), the post's caption as its first line, written like a
 * comment (photo, name, when, the words), then the comments in the same
 * scroll, the quick emoji and the comment box pinned under them. Under the
 * caption, Instagram's "Liked by Marc and 12 others", which opens the Likes
 * over the sheet. The post stays on screen above it, shrunk to fit
 * (PostCard `sheetOpen`), still playing. One swipe down closes it (from the
 * handle, the caption, or the comments once they're scrolled to the top), as
 * do a tap on the post above it and Escape. The coach's card feed keeps
 * CommentsSheet.
 *
 * A workout post's sheet has two tabs (Nov 21 2026), Workout and Comments:
 * the recap's tap opens it on Workout (every exercise with its sets,
 * WorkoutDetails), 💬 and the words on Comments, and one tap moves between
 * them. Both stay mounted while it's open, so a half-typed comment survives
 * a look at the sets, and closing it leaves the post on the slide it was on.
 */
export function PostSheet({ post, at, viewerIsStaff, onClose, onOpenAuthor, unit = "lb" }: {
  post: CommunityPost | null;
  at: PostSheetAt;
  viewerIsStaff: boolean;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
  /** The viewer's unit, only for a set that never said its own. */
  unit?: "kg" | "lb";
}) {
  const open = !!post;
  // the post it was opened on stays in it while it slides away
  const [shown, setShown] = useState<{ post: CommunityPost; at: PostSheetAt } | null>(post ? { post, at } : null);
  useEffect(() => {
    if (post) setShown({ post, at });
  }, [post, at]);
  const content = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const setContent = useCallback((n: HTMLDivElement | null) => {
    content.current = n;
    setNode(n);
  }, []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeNow = useCallback(() => closeRef.current(), []);
  // one swipe down closes it (the grip, the caption, or the comments once they're at the top; never the comment box)
  useSwipeDownToClose(node, open, closeNow);
  // typing: the sheet fills what's on screen above the keyboard
  const vv = useVisualViewportBox(open);
  const item = post ? { post, at } : shown;
  const workout = !!item && sheetHasWorkout(item.post);
  // which tab is up: where it was opened, then wherever they tap
  const [tab, setTab] = useState<"workout" | "comments">(at === "workout" ? "workout" : "comments");
  useEffect(() => {
    if (post) setTab(at === "workout" ? "workout" : "comments");
  }, [post, at]);
  const onWorkout = workout && tab === "workout";
  const openAuthor = onOpenAuthor ? (a: CommunityAuthor) => { onClose(); onOpenAuthor(a); } : undefined;
  // who liked it, over the sheet (gone with the sheet)
  const [likesFor, setLikesFor] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setLikesFor(null);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          ref={setContent}
          aria-describedby={undefined}
          // never the keyboard on open: focus the sheet itself
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.focus({ preventScroll: true });
          }}
          className="phone-column fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-[24px] bg-card shadow-[0_-10px_30px_rgb(0_0_0/0.28)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-200 data-[state=open]:duration-300 sm:mx-auto sm:max-w-[520px]"
          style={vv?.keyboard ? { top: vv.top + 8, height: vv.height - 8, bottom: "auto" } : { height: POST_SHEET_HEIGHT }}
          data-post-sheet={workout ? tab : (item?.at ?? "caption")}
        >
          {/* the grip and the title: drag them (or the words under them) down to close */}
          <div className="relative shrink-0 cursor-grab pb-2 pt-2" data-sheet-handle>
            <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-muted-foreground/35" />
            {workout ? (
              <>
                <Dialog.Title className="sr-only">Workout and comments</Dialog.Title>
                {/* Workout | Comments: the one up at full strength with a short line under it, the other quieter (Crew's tabs) */}
                <div role="tablist" aria-label="Workout or comments" className="mt-1 flex items-center justify-center gap-7" data-post-sheet-tabs>
                  {(
                    [
                      ["workout", "Workout"],
                      ["comments", "Comments"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={cn(
                        "relative h-10 text-[16px] font-semibold leading-6 transition-opacity",
                        tab === k ? "opacity-100" : "opacity-50 active:opacity-70",
                      )}
                      data-sheet-tab={k}
                    >
                      {label}
                      {k === "comments" && item!.post.comment_count > 0 && (
                        <span className="ml-1 font-normal tabular-nums">{item!.post.comment_count}</span>
                      )}
                      <span
                        aria-hidden
                        className={cn("absolute inset-x-1 bottom-1 h-[2px] rounded-full bg-foreground transition-opacity", tab === k ? "opacity-100" : "opacity-0")}
                      />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <Dialog.Title className="mt-2.5 text-center text-[16px] font-semibold leading-6">Comments</Dialog.Title>
            )}
            <Dialog.Close
              className="absolute right-2 top-[14px] grid h-10 w-10 place-items-center rounded-full text-foreground active:scale-95"
              aria-label={workout ? "Close" : "Close comments"}
              data-post-sheet-close
            >
              <X className="h-[22px] w-[22px]" strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {item && workout && (
            // the workout's every set: its own scroll (a pull down from its top closes the sheet)
            <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", !onWorkout && "hidden")} role="tabpanel" data-sheet-scroll data-sheet-workout>
              <WorkoutDetails post={item.post} unit={unit} />
            </div>
          )}
          {item && (
            <div className={cn("flex min-h-0 flex-1 flex-col", onWorkout && "hidden")} role={workout ? "tabpanel" : undefined} data-sheet-comments>
              <CommentThread
                key={item.post.id}
                post={item.post}
                viewerIsStaff={viewerIsStaff}
                onOpenAuthor={openAuthor}
                header={<PostSheetCaption post={item.post} onOpenAuthor={openAuthor} onOpenLikes={() => setLikesFor(item.post.id)} />}
                startAtComments={item.at === "comments"}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
      <ReactorsSheet postId={likesFor} onClose={() => setLikesFor(null)} onOpenAuthor={openAuthor} />
    </Dialog.Root>
  );
}

/**
 * The post's own words as the first line of the comments, the way Instagram
 * lists a caption: the photo, the name and when, then the words, then
 * "Liked by …" (a tap: the Likes), a hairline under them. A post with no
 * words shows only who liked it, and with no likes either, nothing (the
 * comments start the sheet).
 */
function PostSheetCaption({ post, onOpenAuthor, onOpenLikes }: { post: CommunityPost; onOpenAuthor?: (a: CommunityAuthor) => void; onOpenLikes: () => void }) {
  const auto = isAutoPost(post);
  const caption = post.caption?.trim() ? withHandles(post.caption, post.mentions) : null;
  const likes = reactionTotal(post) > 0;
  if (!auto && !caption) {
    if (!likes) return null;
    return (
      <div className="-mx-4 mb-1 border-b border-border/60 px-3 pb-2" data-post-sheet-likes>
        <LikedBy post={post} onOpen={onOpenLikes} />
      </div>
    );
  }
  const open = onOpenAuthor ? () => onOpenAuthor(post.author) : undefined;
  const collabs = post.collaborators ?? [];
  const also = collabs.length === 1 ? ` and ${collabs[0].name}` : collabs.length > 1 ? ` and ${collabs.length} others` : "";
  return (
    <div className="-mx-4 mb-1 flex items-start gap-3 border-b border-border/60 px-4 pb-3.5 pt-1" data-post-sheet-caption>
      {open ? (
        <button type="button" onClick={open} className="shrink-0 rounded-full active:scale-95" aria-label={`Open ${post.author.name}'s profile`}>
          <UserAvatar src={post.author.avatar_url} name={post.author.name} size={36} expandable={false} />
        </button>
      ) : (
        <UserAvatar src={post.author.avatar_url} name={post.author.name} size={36} expandable={false} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5">
          {open ? (
            <button type="button" onClick={open} className="min-w-0 truncate text-left font-semibold active:opacity-70">
              {post.author.name}
              {also}
            </button>
          ) : (
            <span className="min-w-0 truncate font-semibold">
              {post.author.name}
              {also}
            </span>
          )}
          {post.author.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
          <span className="shrink-0 text-[12px] text-muted-foreground">{postTimeLabel(post.created_at)}</span>
        </div>
        {auto ? (
          // an automated post's words with what rides under them (the Recap's "work on this week", a poll)
          <AutoPostCaption post={post} clamp={false} named={false} onOpenPerson={onOpenAuthor} className="px-0 pt-0.5" />
        ) : (
          caption && (
            <p className="mt-0.5 whitespace-pre-line break-words text-[15px] leading-[1.45]">
              <MentionText text={caption.text} mentions={caption.mentions} onOpen={onOpenAuthor} />
            </p>
          )
        )}
        {likes && <LikedBy post={post} onOpen={onOpenLikes} className="-ml-1.5 mt-1.5" />}
      </div>
    </div>
  );
}

