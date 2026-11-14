import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { MentionText } from "@/components/community/mentions";
import { CommentThread } from "@/components/community/comments-sheet";
import { AutoPostCaption, CoachBadge } from "@/components/community/post-card";
import { UserAvatar } from "@/components/user-avatar";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { isAutoPost, postTimeLabel, withHandles, type CommunityAuthor, type CommunityPost } from "@/lib/community";
import { POST_SHEET_HEIGHT, sheetDragCloses, SHEET_DRAG_START_PX } from "@/lib/post-sheet";

/** Where the sheet opens: the caption at the top ("… more"), or scrolled to the comments (💬). */
export type PostSheetAt = "caption" | "comments";

/**
 * A post's words and comments on the clients' paged Crew feed, Instagram's
 * and TikTok's way: a sheet over the bottom of the screen titled Comments
 * (✕ closes it), the post's caption as its first line, written like a
 * comment (photo, name, when, the words), then the comments in the same
 * scroll, the quick emoji and the comment box pinned under them. The post stays on screen above it, shrunk to fit
 * (PostCard `sheetOpen`), still playing. One swipe down closes it (from the
 * handle, the caption, or the comments once they're scrolled to the top), as
 * do a tap on the post above it and Escape. The coach's card feed keeps
 * CommentsSheet.
 */
export function PostSheet({ post, at, viewerIsStaff, onClose, onOpenAuthor }: {
  post: CommunityPost | null;
  at: PostSheetAt;
  viewerIsStaff: boolean;
  onClose: () => void;
  onOpenAuthor?: (a: CommunityAuthor) => void;
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
  useSheetDrag(node, open, closeNow);
  // typing: the sheet fills what's on screen above the keyboard
  const vv = useVisualViewportBox(open);
  const item = post ? { post, at } : shown;
  const openAuthor = onOpenAuthor ? (a: CommunityAuthor) => { onClose(); onOpenAuthor(a); } : undefined;

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
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-[24px] bg-card shadow-[0_-10px_30px_rgb(0_0_0/0.28)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-200 data-[state=open]:duration-300 sm:mx-auto sm:max-w-[520px]"
          style={vv?.keyboard ? { top: vv.top + 8, height: vv.height - 8, bottom: "auto" } : { height: POST_SHEET_HEIGHT }}
          data-post-sheet={item?.at ?? "caption"}
        >
          {/* the grip and the title: drag them (or the words under them) down to close */}
          <div className="relative shrink-0 cursor-grab pb-2 pt-2" data-sheet-handle>
            <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-muted-foreground/35" />
            <Dialog.Title className="mt-2.5 text-center text-[16px] font-semibold leading-6">Comments</Dialog.Title>
            <Dialog.Close
              className="absolute right-2 top-[14px] grid h-10 w-10 place-items-center rounded-full text-foreground active:scale-95"
              aria-label="Close comments"
              data-post-sheet-close
            >
              <X className="h-[22px] w-[22px]" strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {item && (
            <CommentThread
              key={item.post.id}
              post={item.post}
              viewerIsStaff={viewerIsStaff}
              onOpenAuthor={openAuthor}
              header={<PostSheetCaption post={item.post} onOpenAuthor={openAuthor} />}
              startAtComments={item.at === "comments"}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The post's own words as the first line of the comments, the way Instagram
 * lists a caption: the photo, the name and when, then the words, a hairline
 * under them. A post with no words has none (the comments start the sheet).
 */
function PostSheetCaption({ post, onOpenAuthor }: { post: CommunityPost; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const auto = isAutoPost(post);
  const caption = post.caption?.trim() ? withHandles(post.caption, post.mentions) : null;
  if (!auto && !caption) return null;
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
      </div>
    </div>
  );
}

/**
 * One swipe down closes the sheet: a drag that starts on the grip or the
 * caption, or on the comments while they're at the top, moves the sheet with
 * the finger, and letting go far enough down (or with a flick) closes it,
 * else it springs back. A swipe up, or one that starts in the comments
 * further down, scrolls them as usual; the comment box is left alone.
 */
function useSheetDrag(el: HTMLDivElement | null, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active || !el) return;
    let startY = 0;
    let startT = 0;
    let dy = 0;
    let mode: "idle" | "maybe" | "drag" = "idle";
    const settle = () => {
      el.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      el.style.transform = "";
    };
    const onStart = (e: TouchEvent) => {
      mode = "idle";
      if (e.touches.length !== 1) return;
      const t = e.target as Element | null;
      if (t?.closest?.("textarea, input, [contenteditable='true']")) return;
      const list = t?.closest?.("[data-sheet-scroll]") as HTMLElement | null;
      if (list && list.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      startT = e.timeStamp;
      dy = 0;
      mode = "maybe";
    };
    const onMove = (e: TouchEvent) => {
      if (mode === "idle") return;
      const d = e.touches[0].clientY - startY;
      if (mode === "maybe") {
        if (Math.abs(d) < SHEET_DRAG_START_PX) return;
        // up: the comments scroll
        if (d < 0) {
          mode = "idle";
          return;
        }
        mode = "drag";
        el.style.transition = "none";
      }
      e.preventDefault();
      dy = Math.max(0, d);
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
    };
    const onEnd = (e: TouchEvent) => {
      if (mode !== "drag") {
        mode = "idle";
        return;
      }
      mode = "idle";
      // closing slides it out from where the finger left it (the exit animation starts there)
      if (sheetDragCloses({ dy, ms: e.timeStamp - startT, height: el.offsetHeight })) close();
      else settle();
    };
    const onCancel = () => {
      if (mode === "drag") settle();
      mode = "idle";
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [el, active, close]);
}
