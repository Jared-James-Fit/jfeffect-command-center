import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Copy, CornerUpLeft, Eye, EyeOff, Heart, ImagePlus, Loader2, MoreHorizontal, Pin, PinOff, Play, Send, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { CoachBadge } from "@/components/community/post-card";
import { SharedCommentCard } from "@/components/community/shared-comment";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { COMMENT_MAX, likesLabel, pinnedFirst, postTimeLabel, threadComments, type CommunityAuthor, type CommunityComment, type CommunityPost } from "@/lib/community";
import { pickMedia, releasePicked, type PickedMedia } from "@/lib/community-media";
import {
  useAddComment,
  useCommentMediaUrls,
  useComments,
  useCommentsRealtime,
  useCommunityProfile,
  useDeleteComment,
  useFullMediaUrl,
  useHideComment,
  useHintsSeen,
  useLikeComment,
  useMarkHintSeen,
  usePinComment,
  useShareComment,
  useSyncCommentCount,
} from "@/lib/community.queries";

const NOTE_MAX = 1200;
/** Replies shown under a comment before "View all". */
const REPLIES_SHOWN = 2;

/**
 * Light chatter on a post. Coaching conversations stay in Messages — this is
 * the "nice work" and the banter.
 */
export function CommentsSheet({ post, viewerIsStaff, onClose }: { post: CommunityPost | null; viewerIsStaff: boolean; onClose: () => void }) {
  return (
    <Sheet open={!!post} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="flex h-[78dvh] max-h-[640px] flex-col gap-0 rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        {post && (
          <>
            <SheetHeader className="shrink-0 border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-base font-black">Comments</SheetTitle>
                  <SheetDescription className="text-xs">Quick encouragement. Coaching questions belong in Messages.</SheetDescription>
                </div>
                <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
            </SheetHeader>
            <CommentThread key={post.id} post={post} viewerIsStaff={viewerIsStaff} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

type ReplyTarget = { id: string; threadId: string; name: string; mine: boolean };

/**
 * Comment list + composer. Comments and likes sync live; hold any comment for
 * its options. `inline` renders without its own scroll area (post detail).
 */
export function CommentThread({ post, viewerIsStaff, inline = false }: { post: CommunityPost; viewerIsStaff: boolean; inline?: boolean }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [picked, setPicked] = useState<PickedMedia | null>(null);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [menuFor, setMenuFor] = useState<CommunityComment | null>(null);
  const [shareFor, setShareFor] = useState<CommunityComment | null>(null);
  const [deleteFor, setDeleteFor] = useState<CommunityComment | null>(null);
  const [viewing, setViewing] = useState<CommunityComment | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickedRef = useRef<PickedMedia | null>(null);
  pickedRef.current = picked;

  const list = useComments(post.id, true);
  const comments = useMemo(() => list.data ?? [], [list.data]);
  const sync = useCommentsRealtime(post.id);
  useSyncCommentCount(post.id, list.data);
  const add = useAddComment(post.id, viewerIsStaff, post.is_mine);
  const like = useLikeComment(post.id);
  const del = useDeleteComment(post.id);
  const hide = useHideComment(post.id);
  const pin = usePinComment(post.id);
  // Local, so the sheet reflects a pin straight away (the `post` prop is a snapshot).
  const [pinnedId, setPinnedId] = useState<string | null>(post.pinned_comment_id ?? null);
  useEffect(() => setPinnedId(post.pinned_comment_id ?? null), [post.id, post.pinned_comment_id]);
  const { data: urls } = useCommentMediaUrls(comments);
  const { data: profile } = useCommunityProfile(user?.id ?? null);
  const hints = useHintsSeen();
  const markHint = useMarkHintSeen();
  const threads = useMemo(() => pinnedFirst(threadComments(comments), pinnedId), [comments, pinnedId]);
  const showHoldTip = !!hints.data && !hints.data.includes("comment_hold") && comments.some((c) => !c.pending);

  // an unsent photo is let go with the composer
  useEffect(() => () => releasePicked(pickedRef.current), []);

  const me: CommunityAuthor = profile?.author ?? { user_id: user?.id ?? "me", name: "You", avatar_url: null, is_coach: viewerIsStaff };
  const body = text.trim();
  const canSend = (!!body || !!picked) && !!user?.id && !picking;

  const send = () => {
    if (!canSend || !user?.id) return;
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const media = picked;
    const to = replyTo;
    setText("");
    setPicked(null);
    setReplyTo(null);
    if (to) setExpanded((s) => new Set(s).add(to.threadId));
    add
      .mutateAsync({
        tempId,
        body,
        parentId: to?.id ?? null,
        threadId: to?.threadId ?? null,
        replyTo: to && !to.mine ? to.name : null,
        media,
        userId: user.id,
        me,
        onProgress: media ? (pct) => setProgress((p) => ({ ...p, [tempId]: pct })) : undefined,
      })
      .catch((e: any) => {
        toast.error(e?.message ?? "Couldn't post that comment");
        // put it back so nothing typed is lost
        setText((t) => t || body);
        if (media) setPicked((p) => p ?? media);
        if (to) setReplyTo((r) => r ?? to);
      })
      .finally(() =>
        setProgress((p) => {
          const { [tempId]: _done, ...rest } = p;
          return rest;
        }),
      );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPicking(true);
    const res = await pickMedia(file);
    setPicking(false);
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    releasePicked(pickedRef.current);
    setPicked(res.media);
    inputRef.current?.focus();
  };

  const startReply = (c: CommunityComment) => {
    setReplyTo({ id: c.id, threadId: c.parent_id ?? c.id, name: c.author.name, mine: !!c.is_mine });
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const toggleLike = (c: CommunityComment) => {
    if (c.pending) return;
    like.mutate({ id: c.id, liked: !c.liked }, { onError: (e: any) => toast.error(e?.message ?? "Couldn't like that") });
  };
  const openMenu = (c: CommunityComment) => {
    if (c.pending) return;
    setMenuFor(c);
    if (showHoldTip) markHint("comment_hold");
  };
  const setHidden = (c: CommunityComment, hidden: boolean) => {
    hide
      .mutateAsync({ id: c.id, hidden })
      .then(() => {
        sync();
        if (hidden) toast(`Hidden. ${seenBy(c)} can see it.`, { action: { label: "Undo", onClick: () => setHidden(c, false) } });
        else toast("Showing again");
      })
      .catch((e: any) => toast.error(e?.message ?? "Couldn't change that"));
  };
  const togglePin = (c: CommunityComment) => {
    const next = pinnedId !== c.id;
    const before = pinnedId;
    setPinnedId(next ? c.id : null);
    pin
      .mutateAsync({ id: c.id, pinned: next })
      .then(() => toast(next ? "Pinned to the top" : "Unpinned"))
      .catch((e: any) => {
        setPinnedId(before);
        toast.error(e?.message ?? "Couldn't pin that");
      });
  };
  const remove = (c: CommunityComment) => {
    if (replyTo && (replyTo.id === c.id || replyTo.threadId === c.id)) setReplyTo(null);
    del.mutateAsync(c).then(
      () => toast("Comment deleted"),
      (e: any) => toast.error(e?.message ?? "Couldn't delete that"),
    );
  };

  const replyCount = (c: CommunityComment) => comments.filter((x) => x.parent_id === c.id).length;
  // who still sees a hidden comment: its writer (nothing tells them), the post's owner, coaches
  const seenBy = (c: CommunityComment) => {
    const writer = c.author.name.split(" ")[0];
    return post.is_mine ? `Only you, coaches and ${writer}` : `Only coaches, ${post.author.name.split(" ")[0]} and ${writer}`;
  };

  return (
    <>
      <div className={inline ? "space-y-1 px-4 py-3" : "min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-3"}>
        {list.isLoading ? (
          <CommentSkeleton />
        ) : list.isError && comments.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Couldn't load comments.{" "}
            <button type="button" className="font-bold text-foreground underline" onClick={() => void list.refetch()}>
              Try again
            </button>
          </div>
        ) : comments.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No comments yet. Say something nice.</div>
        ) : (
          <>
            {showHoldTip && <p className="pb-1 text-center text-[11px] font-semibold text-muted-foreground">Hold a comment to reply, share or copy it</p>}
            {threads.map(({ comment, replies }) => {
              const open = expanded.has(comment.id) || replies.length <= REPLIES_SHOWN + 1;
              const shown = open ? replies : replies.slice(-REPLIES_SHOWN);
              return (
                <div key={comment.id}>
                  <CommentRow c={comment} pinned={comment.id === pinnedId && !comment.hidden} url={urlFor(comment, urls)} progress={progress[comment.id]} onReply={startReply} onLike={toggleLike} onHold={openMenu} onOpenMedia={setViewing} />
                  {replies.length > 0 && (
                    <div className="ml-10 space-y-0.5">
                      {!open && (
                        <button
                          type="button"
                          onClick={() => setExpanded((s) => new Set(s).add(comment.id))}
                          className="flex h-8 items-center gap-2 text-[12px] font-bold text-muted-foreground"
                        >
                          <span className="h-px w-6 bg-border" /> View all {replies.length} replies
                        </button>
                      )}
                      {shown.map((r) => (
                        <CommentRow key={r.id} c={r} reply url={urlFor(r, urls)} progress={progress[r.id]} onReply={startReply} onLike={toggleLike} onHold={openMenu} onOpenMedia={setViewing} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className={inline ? "px-3 pb-3 pt-1" : "shrink-0 border-t border-border/70 bg-background px-3 pt-2"} style={inline ? undefined : { paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-1.5 text-[12px] font-semibold text-muted-foreground">
            <span className="truncate">
              Replying to <span className="text-foreground">{replyTo.mine ? "yourself" : replyTo.name}</span>
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full" aria-label="Cancel reply">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {picked && (
          <div className="relative mb-2 inline-block">
            {picked.kind === "video" ? (
              <video src={`${picked.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="h-20 w-20 rounded-xl bg-muted object-cover" />
            ) : (
              <img src={picked.previewUrl} alt="" className="h-20 w-20 rounded-xl bg-muted object-cover" />
            )}
            {picked.kind === "video" && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <Play className="h-5 w-5 fill-white text-white drop-shadow" />
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                releasePicked(picked);
                setPicked(null);
              }}
              className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-foreground text-background shadow"
              aria-label="Remove photo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={picking}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Add a photo or video"
          >
            {picking ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          </button>
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, COMMENT_MAX))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={replyTo ? `Reply to ${replyTo.mine ? "yourself" : replyTo.name.split(" ")[0]}…` : viewerIsStaff && !post.is_mine ? "Say something to them…" : "Add a comment…"}
            className="min-h-11 flex-1 resize-none rounded-2xl text-[16px]"
            aria-label={replyTo ? "Write a reply" : "Add a comment"}
          />
          <Button type="button" size="icon" className="h-11 w-11 shrink-0 rounded-full" disabled={!canSend} onClick={send} aria-label="Send comment">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <CommentMenu
        c={menuFor}
        onClose={() => setMenuFor(null)}
        onReply={startReply}
        onLike={toggleLike}
        onShare={setShareFor}
        onHide={setHidden}
        onDelete={setDeleteFor}
        seenBy={seenBy}
        // Only the person who posted pins, and only top-level comments that are showing.
        canPin={(c) => post.is_mine && !c.parent_id && !c.hidden && !c.pending}
        pinnedId={pinnedId}
        onPin={togglePin}
      />
      <ShareCommentSheet c={shareFor} onClose={() => setShareFor(null)} postAuthor={post.author.name} />
      <MediaViewer c={viewing} thumbUrl={viewing ? urlFor(viewing, urls) : null} onClose={() => setViewing(null)} />

      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFor && !deleteFor.is_mine ? `${deleteFor.author.name.split(" ")[0]}'s comment is removed for everyone.` : "It's gone for everyone."}
              {deleteFor && replyCount(deleteFor) > 0 ? ` Its ${replyCount(deleteFor) === 1 ? "reply goes" : `${replyCount(deleteFor)} replies go`} too.` : ""}
              {deleteFor?.can_hide ? " Hiding it instead keeps it out of sight without deleting it." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            {deleteFor?.can_hide && !deleteFor.hidden && (
              <AlertDialogAction className="bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={() => deleteFor && setHidden(deleteFor, true)}>
                Hide instead
              </AlertDialogAction>
            )}
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteFor && remove(deleteFor)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function urlFor(c: CommunityComment, urls: Record<string, string> | undefined): string | null {
  const m = c.media;
  if (!m) return null;
  const p = m.thumb ?? (m.type === "image" ? m.path : null);
  return (p && urls?.[p]) || null;
}

function CommentSkeleton() {
  return (
    <div className="space-y-4 py-2" aria-label="Loading comments">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-2.5">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className={cn("h-3 animate-pulse rounded bg-muted", i === 1 ? "w-1/2" : "w-4/5")} />
          </div>
        </div>
      ))}
    </div>
  );
}

const HOLD_MS = 450;

/** Hold (touch or mouse) to open a comment's options; right-click and the keyboard work too. */
function useHold(onHold: () => void, disabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const [pressing, setPressing] = useState(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
    setPressing(false);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const fire = () => {
    cancel();
    held.current = true;
    try {
      navigator.vibrate?.(8);
    } catch {
      /* no haptics */
    }
    onHold();
  };
  return {
    pressing,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        held.current = false;
        if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        if ((e.target as HTMLElement).closest("[data-no-hold]")) return;
        start.current = { x: e.clientX, y: e.clientY };
        setPressing(true);
        timer.current = setTimeout(fire, HOLD_MS);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
        e.preventDefault();
        if (disabled || held.current) return;
        fire();
      },
      // the tap that ends a hold doesn't also open the photo
      onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
        if (!held.current) return;
        held.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
        if (disabled || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " " || e.key === "ContextMenu") {
          e.preventDefault();
          onHold();
        }
      },
    },
  };
}

function CommentRow({
  c,
  reply = false,
  pinned = false,
  url,
  progress,
  onReply,
  onLike,
  onHold,
  onOpenMedia,
}: {
  c: CommunityComment;
  reply?: boolean;
  /** Pinned by the person who posted: sits first, labelled. */
  pinned?: boolean;
  url: string | null;
  progress?: number;
  onReply: (c: CommunityComment) => void;
  onLike: (c: CommunityComment) => void;
  onHold: (c: CommunityComment) => void;
  onOpenMedia: (c: CommunityComment) => void;
}) {
  const hold = useHold(() => onHold(c), !!c.pending);
  const likes = likesLabel(c.likes);
  return (
    <div
      {...hold.handlers}
      tabIndex={c.pending ? -1 : 0}
      data-comment-id={c.id}
      aria-label={`${c.author.name}: ${c.body || (c.media?.type === "video" ? "a video" : "a photo")}. Hold for options.`}
      className={cn(
        "group -mx-2 flex select-none items-start gap-2.5 rounded-2xl px-2 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        hold.pressing && "bg-muted",
        c.pending && "opacity-60",
        c.hidden && "opacity-60",
      )}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}
    >
      <UserAvatar src={c.author.avatar_url} name={c.author.name} size={reply ? 26 : 32} expandable={false} />
      <div className="min-w-0 flex-1">
        {pinned && (
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <Pin className="h-3 w-3 rotate-45" /> Pinned
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-bold">{c.author.name}</span>
          {c.author.is_coach && <CoachBadge className="h-3.5 w-3.5" />}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {c.pending ? (progress != null && progress < 100 ? `Uploading ${progress}%` : "Sending…") : postTimeLabel(c.created_at)}
          </span>
        </div>
        {(c.body || c.reply_to) && (
          <p className="whitespace-pre-line break-words text-[14px] leading-snug">
            {c.reply_to && <span className="font-semibold text-primary">@{c.reply_to} </span>}
            {c.body}
          </p>
        )}
        {c.media && <CommentMedia c={c} url={url} onOpen={onOpenMedia} />}
        {!c.pending && (
          <div className="mt-0.5 flex items-center gap-3.5 text-[12px] font-semibold text-muted-foreground">
            {likes && <span>{likes}</span>}
            <button type="button" data-no-hold onClick={() => onReply(c)} className="py-1 hover:text-foreground">
              Reply
            </button>
            {c.hidden && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                <EyeOff className="h-3 w-3" /> Hidden
              </span>
            )}
          </div>
        )}
      </div>
      {!c.pending && (
        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            data-no-hold
            onClick={() => onLike(c)}
            aria-pressed={!!c.liked}
            aria-label={c.liked ? "Unlike comment" : "Like comment"}
            className="grid h-9 w-9 place-items-center rounded-full active:scale-90"
          >
            <Heart className={cn("h-[18px] w-[18px] transition-transform", c.liked ? "scale-110 fill-[#ef3340] text-[#ef3340]" : "text-muted-foreground")} />
          </button>
          {/* mouse users get a visible way in (touch holds) */}
          <button
            type="button"
            data-no-hold
            onClick={() => onHold(c)}
            className="hidden h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted [@media(hover:hover)]:group-hover:grid"
            aria-label="Comment options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function CommentMedia({ c, url, onOpen }: { c: CommunityComment; url: string | null; onOpen: (c: CommunityComment) => void }) {
  const m = c.media!;
  const ratio = m.width && m.height ? Math.min(Math.max(m.width / m.height, 0.6), 1.6) : 1;
  const local = c.local_preview ?? null;
  return (
    <button
      type="button"
      onClick={() => !c.pending && onOpen(c)}
      className="relative mt-1.5 block overflow-hidden rounded-2xl bg-muted"
      style={{ width: ratio >= 1 ? 200 : Math.round(220 * ratio), maxWidth: "100%", aspectRatio: String(ratio) }}
      aria-label={m.type === "video" ? "Play video" : "Open photo"}
    >
      {local && m.type === "video" ? (
        <video src={`${local}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : local || url ? (
        <img src={local ?? url!} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
      ) : null}
      {m.type === "video" && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white">
            <Play className="ml-0.5 h-4 w-4 fill-white" />
          </span>
        </span>
      )}
      {c.pending && (
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </span>
      )}
    </button>
  );
}

/** What holding a comment opens. Delete only shows for its writer, the post's owner and coaches. */
function CommentMenu({
  c,
  onClose,
  onReply,
  onLike,
  onShare,
  onHide,
  onDelete,
  seenBy,
  canPin,
  pinnedId,
  onPin,
}: {
  c: CommunityComment | null;
  onClose: () => void;
  onReply: (c: CommunityComment) => void;
  onLike: (c: CommunityComment) => void;
  onShare: (c: CommunityComment) => void;
  onHide: (c: CommunityComment, hidden: boolean) => void;
  onDelete: (c: CommunityComment) => void;
  /** "Only you, coaches and Fionna": who still sees it once hidden. */
  seenBy: (c: CommunityComment) => string;
  canPin: (c: CommunityComment) => boolean;
  pinnedId: string | null;
  onPin: (c: CommunityComment) => void;
}) {
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[520px]">
        {c && (
          <>
            <SheetHeader className="border-b border-border/70 px-4 pb-3 pt-4 text-left">
              <SheetTitle className="flex items-center gap-2 text-[13px] font-bold">
                <UserAvatar src={c.author.avatar_url} name={c.author.name} size={22} expandable={false} />
                <span className="truncate">{c.is_mine ? "Your comment" : `${c.author.name}'s comment`}</span>
              </SheetTitle>
              <SheetDescription className="line-clamp-3 whitespace-pre-line text-[13px] text-foreground/80">
                {c.body || (c.media?.type === "video" ? "A video" : "A photo")}
              </SheetDescription>
            </SheetHeader>
            <div className="py-1">
              {canPin(c) && (
                <MenuRow
                  icon={pinnedId === c.id ? PinOff : Pin}
                  label={pinnedId === c.id ? "Unpin" : "Pin comment"}
                  sub={pinnedId === c.id ? undefined : pinnedId ? "Replaces the one pinned now" : "Shows first, here and in the feed"}
                  onClick={act(() => onPin(c))}
                />
              )}
              <MenuRow icon={CornerUpLeft} label="Reply" onClick={act(() => onReply(c))} />
              <MenuRow
                icon={Heart}
                label={c.liked ? "Unlike" : "Like"}
                iconClass={c.liked ? "fill-[#ef3340] text-[#ef3340]" : undefined}
                onClick={act(() => onLike(c))}
              />
              {c.can_share && <MenuRow icon={Share2} label="Share as a post" onClick={act(() => onShare(c))} />}
              {!!c.body && (
                <MenuRow
                  icon={Copy}
                  label="Copy text"
                  onClick={act(() => {
                    void navigator.clipboard?.writeText(c.body).then(
                      () => toast("Copied"),
                      () => toast.error("Couldn't copy"),
                    );
                  })}
                />
              )}
              {c.can_hide && (
                <MenuRow
                  icon={c.hidden ? Eye : EyeOff}
                  label={c.hidden ? "Show it again" : "Hide comment"}
                  sub={c.hidden ? undefined : `${seenBy(c)} will see it`}
                  onClick={act(() => onHide(c, !c.hidden))}
                />
              )}
              {c.can_delete && <MenuRow icon={Trash2} label="Delete" danger onClick={act(() => onDelete(c))} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MenuRow({
  icon: Icon,
  label,
  sub,
  danger = false,
  iconClass,
  onClick,
}: {
  icon: typeof Heart;
  label: string;
  sub?: string;
  danger?: boolean;
  iconClass?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-[52px] w-full items-center gap-3.5 px-5 py-2.5 text-left hover:bg-muted active:bg-muted", danger && "text-destructive")}>
      <Icon className={cn("h-5 w-5 shrink-0", iconClass)} />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {sub && <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

/** Share a comment to the feed as its own post, with an optional line of your own. */
function ShareCommentSheet({ c, onClose, postAuthor }: { c: CommunityComment | null; onClose: () => void; postAuthor: string }) {
  const [caption, setCaption] = useState("");
  const share = useShareComment();
  useEffect(() => {
    if (c) setCaption("");
  }, [c]);
  const submit = () => {
    if (!c || share.isPending) return;
    share.mutate(
      { commentId: c.id, caption },
      {
        onSuccess: () => {
          toast.success("Shared to the feed");
          onClose();
        },
        onError: (e: any) => toast.error(e?.message ?? "Couldn't share that"),
      },
    );
  };
  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 sm:mx-auto sm:max-w-[520px]">
        {c && (
          <>
            <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="text-base font-black">Share as a post</SheetTitle>
                  <SheetDescription className="text-xs">It goes on the feed for the whole community.</SheetDescription>
                </div>
                <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </SheetClose>
              </div>
            </SheetHeader>
            <div className="space-y-3 px-4 py-4">
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, NOTE_MAX))}
                rows={2}
                placeholder="Add your own words (optional)"
                className="resize-none rounded-2xl text-[16px]"
                aria-label="Your words"
              />
              <SharedCommentCard shared={{ author: c.author, body: c.body, media: c.media ?? null, post_author: postAuthor }} />
            </div>
            <div className="border-t border-border/70 px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}>
              <Button type="button" className="h-12 w-full rounded-full text-[15px] font-bold" disabled={share.isPending} onClick={submit}>
                {share.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Share
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Full-size photo / the video, only fetched when opened. */
function MediaViewer({ c, thumbUrl, onClose }: { c: CommunityComment | null; thumbUrl: string | null; onClose: () => void }) {
  const m = c?.media ?? null;
  const local = c?.local_preview ?? null;
  const { data: full } = useFullMediaUrl(m?.path, !!m && !local);
  const src = local ?? full ?? (m?.type === "image" ? thumbUrl : null);
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showBackButton={false} className="w-[calc(100vw-1rem)] max-w-[640px] gap-0 overflow-hidden border-0 bg-black p-0 sm:rounded-2xl">
        <DialogTitle className="sr-only">{m?.type === "video" ? "Video" : "Photo"} from {c?.author.name}</DialogTitle>
        <button type="button" onClick={onClose} className="absolute right-2 top-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        {m?.type === "video" ? (
          src ? (
            <video key={src} src={src} poster={thumbUrl ?? undefined} controls autoPlay playsInline className="max-h-[85dvh] w-full bg-black" />
          ) : (
            <div className="grid h-64 place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )
        ) : src ? (
          <img src={src} alt="" className="max-h-[85dvh] w-full object-contain" />
        ) : (
          <div className="grid h-64 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
