import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { CommentThread } from "@/components/community/comments-sheet";
import { AutoPostCaption } from "@/components/community/post-card";
import { LikedBy, ReactorsSheet } from "@/components/community/reactors-sheet";
import { WorkoutDetails } from "@/components/community/workout-details";
import { StoryAvatar } from "@/components/community/story-ring";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { isAutoPost, postTimeLabel, reactionTotal, withHandles, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { cn } from "@/lib/utils";
import { SHEET_SETTLE, useSwipeDownToClose } from "@/hooks/use-swipe-down-to-close";
import { POST_SHEET_FULL_HEIGHT, POST_SHEET_HEIGHT } from "@/lib/post-sheet";
import { CaptionText } from "@/components/community/caption-text";
import { NameMarks } from "@/components/name-marks";

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
  // typing: the sheet fills what's on screen above the keyboard
  const vv = useVisualViewportBox(open);
  // half the screen to start; a drag up (or a tap on the grip) opens it to nearly all of it, for a long caption or thread
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (open) setFull(false);
  }, [open, post?.id]);
  // one swipe down closes it (the grip, the caption, or the comments once they're at the top; never the comment box),
  // and a swipe up from half opens it up
  useSwipeDownToClose(node, open, closeNow, {
    full,
    enabled: !vv?.keyboard,
    halfCss: POST_SHEET_HEIGHT,
    fullCss: POST_SHEET_FULL_HEIGHT,
    onChange: setFull,
  });
  const toggleFull = () => {
    if (content.current) content.current.style.transition = SHEET_SETTLE;
    setFull((f) => !f);
  };
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
          style={vv?.keyboard ? { top: vv.top + 8, height: vv.height - 8, bottom: "auto" } : { height: full ? POST_SHEET_FULL_HEIGHT : POST_SHEET_HEIGHT }}
          data-post-sheet={workout ? tab : (item?.at ?? "caption")}
          data-sheet-full={full ? "" : undefined}
        >
          {/* the grip and the title: drag them (or the words under them) down to close */}
          <div className="relative shrink-0 cursor-grab pb-2 pt-2" data-sheet-handle>
            {/* the grip: drag it up for more room, down to close; a tap opens it up or back to half */}
            <button
              type="button"
              onClick={toggleFull}
              disabled={!!vv?.keyboard}
              className="absolute inset-x-0 top-0 mx-auto h-5 w-24 rounded-full"
              aria-label={full ? "Show less" : "Show more"}
              aria-expanded={full}
              data-sheet-grip
            >
              <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-muted-foreground/35" />
            </button>
            <span aria-hidden className="block h-1" />
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
 * The post's own words at the top of the sheet, apart from the comments
 * under it (Nov 21 2026): the author's row (photo, name, when), then the
 * caption full width in the post font with its paragraphs as written
 * (CaptionText), then "Liked by …" (a tap: the Likes), and a hairline before
 * the first comment. Comments sit indented beside their photos in a smaller
 * size, so the post and the replies to it never read as one list. A post with
 * no words shows only who liked it, and with no likes either, nothing (the
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
    <div className="-mx-4 mb-2 border-b border-border/60 px-4 pb-4 pt-1" data-post-sheet-caption>
      <div className="flex min-w-0 items-center gap-2.5">
        {/* their story ring when they have one up (a tap plays it), else the photo opens their profile */}
        <StoryAvatar userId={post.author.user_id} src={post.author.avatar_url} name={post.author.name} size={32} onPress={open} pressLabel={`Open ${post.author.name}'s profile`} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[14px] leading-5">
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
            <NameMarks person={post.author} userId={post.author.user_id} size={13} />
          </div>
          <div className="text-[12px] leading-4 text-muted-foreground">{postTimeLabel(post.created_at)}</div>
        </div>
      </div>
      {auto ? (
        // an automated post's words with what rides under them (the Recap's "work on this week", a poll)
        <AutoPostCaption post={post} clamp={false} named={false} onOpenPerson={onOpenAuthor} className="px-0 pt-2.5" />
      ) : (
        caption && (
          <CaptionText text={caption.text} mentions={caption.mentions} onOpenPerson={onOpenAuthor} className="mt-2.5 text-[15px] leading-[1.5]" />
        )
      )}
      {likes && <LikedBy post={post} onOpen={onOpenLikes} className="-ml-1.5 mt-2.5" />}
    </div>
  );
}
