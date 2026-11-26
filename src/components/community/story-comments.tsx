import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Globe2, Heart, ImagePlus, Loader2, Pin, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { NameMarks } from "@/components/name-marks";
import { ReportSheet } from "@/components/community/report-sheet";
import { CommentMedia, CommentMenu, MediaViewer, ShareCommentSheet, mediaWord, urlFor, useHold } from "@/components/community/comments-sheet";
import { MicButton, RecordingBar, VoiceMemoPlayer, useVoiceMemoRecorder, type RecordedVoice } from "@/components/community/voice-memo";
import { GifPicker } from "@/components/gif-picker";
import { useVideoTrimmer } from "@/components/video-trimmer";
import { HapticTap } from "@/components/haptic-tap";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { useSwipeDownToClose } from "@/hooks/use-swipe-down-to-close";
import { cn } from "@/lib/utils";
import { COMMENT_MAX, PREVIEW_ONLY_MESSAGE, compactNumber, pinnedFirst, postTimeLabel, threadComments, type CommunityAuthor, type CommunityComment, type CommunityPost } from "@/lib/community";
import { insertAtCursor } from "@/lib/comment-composer";
import { pickMedia, releasePicked, type PickedMedia } from "@/lib/community-media";
import type { MediaItem } from "@/lib/media/media";
import { SentMediaView } from "@/components/media/media-view";
import { STORY_COMMENT_STICKERS, commentCountWords, isStickerText } from "@/lib/story-comments";
import {
  useAddComment,
  useCommentMediaUrls,
  useComments,
  useCommentsRealtime,
  useCommunityProfile,
  useDeleteComment,
  useHideComment,
  useLikeComment,
  usePinComment,
} from "@/lib/community.queries";

/** Replies shown under a comment before "View N more". */
const REPLIES_SHOWN = 2;

type ReplyTarget = { id: string; threadId: string; name: string; mine: boolean };

/**
 * Every comment on a story, in a light panel that's part of the story itself
 * (Nov 26 2026): the story stays on screen above it, paused where it was, and
 * carries on from the same spot when the panel closes. It's never the feed's
 * comment sheet, never a dialog of its own and never a page, so opening it
 * can't turn the story into a post, lose its place or stack a second story on
 * top. Comments here are public (everyone who can see the story; the header
 * says so with the globe); the "Message …" field under the story is the
 * private reply. Text, emoji (one to three on their own read as a sticker),
 * stickers in one tap, GIFs, a photo or clip and a voice memo; posting,
 * liking and deleting show at once and put themselves back if the server says
 * no. Swipe it down, tap the story above it, ✕ or Esc to close it.
 */
export function StoryCommentsPanel({
  post,
  open,
  onClose,
  viewerIsStaff,
  onOpenPerson,
}: {
  post: CommunityPost;
  open: boolean;
  onClose: () => void;
  viewerIsStaff: boolean;
  /** A commenter's photo or name: their profile (the story closes first). */
  onOpenPerson?: (a: CommunityAuthor) => void;
}) {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const panel = useRef<HTMLDivElement | null>(null);
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const setPanel = useCallback((n: HTMLDivElement | null) => {
    panel.current = n;
    setPanelEl(n);
  }, []);

  const list = useComments(post.id, open);
  const comments = useMemo(() => list.data ?? [], [list.data]);
  // a hide reaches everyone else through the channel (realtime can't tell them)
  const sync = useCommentsRealtime(post.id, open);
  const add = useAddComment(post.id, viewerIsStaff, post.is_mine);
  const like = useLikeComment(post.id);
  const del = useDeleteComment(post.id);
  const hide = useHideComment(post.id);
  const pin = usePinComment(post.id);
  const { data: urls } = useCommentMediaUrls(comments);
  const { data: profile } = useCommunityProfile(user?.id ?? null);
  const [pinnedId, setPinnedId] = useState<string | null>(post.pinned_comment_id ?? null);
  useEffect(() => setPinnedId(post.pinned_comment_id ?? null), [post.id, post.pinned_comment_id]);
  const threads = useMemo(() => pinnedFirst(threadComments(comments), pinnedId), [comments, pinnedId]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const visible = comments.filter((c) => !c.hidden).length;

  // the composer
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [picked, setPicked] = useState<PickedMedia | null>(null);
  const pickedRef = useRef<PickedMedia | null>(null);
  pickedRef.current = picked;
  // one attachment at a time: a photo / clip, a GIF / sticker, or a voice memo
  const [gif, setGif] = useState<MediaItem | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [voice, setVoice] = useState<RecordedVoice | null>(null);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [focused, setFocused] = useState(false);
  const trimmer = useVideoTrimmer();
  const recorder = useVoiceMemoRecorder((v) => {
    releasePicked(pickedRef.current);
    setPicked(null);
    setGif(null);
    setVoice(v);
  });
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // what you just sent shows at once (optimistic): the list follows it down once it's there
  const scrollToNew = useRef(false);
  const lastCount = useRef(0);
  useEffect(() => {
    const grew = comments.length > lastCount.current;
    lastCount.current = comments.length;
    if (!grew || !scrollToNew.current) return;
    scrollToNew.current = false;
    const box = listRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [comments.length]);
  useEffect(() => () => releasePicked(pickedRef.current), []);

  // the menu a hold opens, and what it leads to
  const [menuFor, setMenuFor] = useState<CommunityComment | null>(null);
  const [shareFor, setShareFor] = useState<CommunityComment | null>(null);
  const [deleteFor, setDeleteFor] = useState<CommunityComment | null>(null);
  const [reportFor, setReportFor] = useState<CommunityComment | null>(null);
  const [reporting, setReporting] = useState(false);
  const [viewing, setViewing] = useState<CommunityComment | null>(null);

  // the keyboard: the panel rides on top of it, its header still in view
  const view = useVisualViewportBox(open && focused);
  const lift = view?.keyboard ? Math.max(0, window.innerHeight - view.top - view.height) : 0;
  const keyboardMax = view?.keyboard ? Math.max(220, view.height - 72) : null;

  const close = useCallback(() => {
    // a swipe left its own transition on the element: the slide out is ours again
    if (panel.current) panel.current.style.transition = "";
    inputRef.current?.blur();
    onClose();
  }, [onClose]);
  // one swipe down closes it (never from the text box, never while a list scrolled down scrolls back)
  useSwipeDownToClose(panelEl, open && !focused, close);

  // closed: nothing typed half-way is lost, but nothing stays open either
  useEffect(() => {
    if (open) return;
    setMenuFor(null);
    setGifOpen(false);
    inputRef.current?.blur();
  }, [open]);

  const me: CommunityAuthor = profile?.author ?? { user_id: user?.id ?? "me", name: "You", avatar_url: null, is_coach: viewerIsStaff };
  const body = text.trim();
  const canSend = (!!body || !!picked || !!gif || !!voice) && !!user?.id && !picking && !recorder.recording;

  const send = (override?: string) => {
    const words = (override ?? body).trim();
    if (isImpersonating) return void toast.message(PREVIEW_ONLY_MESSAGE);
    if (!user?.id) return;
    const sticker = override != null;
    if (!sticker && !canSend) return;
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const media = sticker ? null : picked;
    const pickedGif = sticker ? null : gif;
    const g = pickedGif ? { url: pickedGif.url, thumb: pickedGif.preview !== pickedGif.url ? pickedGif.preview : null, kind: pickedGif.kind, width: pickedGif.width, height: pickedGif.height } : null;
    const v = sticker ? null : voice;
    const to = replyTo;
    if (!sticker) {
      setText("");
      setPicked(null);
      setGif(null);
      setVoice(null);
    }
    setReplyTo(null);
    if (to) setExpanded((s) => new Set(s).add(to.threadId));
    // the newest lands at the bottom: brought into view as it appears (below)
    scrollToNew.current = !to;
    add
      .mutateAsync({
        tempId,
        body: words,
        parentId: to?.id ?? null,
        threadId: to?.threadId ?? null,
        replyTo: to && !to.mine ? to.name : null,
        media,
        gif: g,
        voice: v,
        userId: user.id,
        me,
        onProgress: media || v ? (pct) => setProgress((p) => ({ ...p, [tempId]: pct })) : undefined,
      })
      .catch((e: any) => {
        toast.error(e?.message ?? "Couldn't post that comment");
        // back in the box, so nothing is lost
        if (!sticker) {
          setText((t) => t || words);
          if (media) setPicked((p) => p ?? media);
          if (v) setVoice((x) => x ?? v);
          if (pickedGif) setGif((x) => x ?? pickedGif);
        }
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
    const res = await pickMedia(file, { context: "comment", trim: trimmer.request });
    setPicking(false);
    if (!res.ok) {
      if (!res.cancelled) toast.error(res.reason);
      return;
    }
    releasePicked(pickedRef.current);
    setPicked(res.media);
    setGif(null);
    setVoice(null);
    inputRef.current?.focus({ preventScroll: true });
  };
  const startReply = (c: CommunityComment) => {
    setReplyTo({ id: c.id, threadId: c.parent_id ?? c.id, name: c.author.name, mine: !!c.is_mine });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };
  const addEmoji = (emoji: string) => {
    const el = inputRef.current;
    const next = insertAtCursor(text, emoji, el?.selectionStart, el?.selectionEnd, COMMENT_MAX);
    if (next.text === text) return;
    setText(next.text);
    requestAnimationFrame(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus({ preventScroll: true });
      box.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const toggleLike = (c: CommunityComment) => {
    if (c.pending) return;
    if (isImpersonating) return void toast.message(PREVIEW_ONLY_MESSAGE);
    like.mutate({ id: c.id, liked: !c.liked }, { onError: (e: any) => toast.error(e?.message ?? "Couldn't like that") });
  };
  const seenBy = (c: CommunityComment) => {
    const writer = c.author.name.split(" ")[0];
    return post.is_mine ? `Only you, coaches and ${writer}` : `Only coaches, ${post.author.name.split(" ")[0]} and ${writer}`;
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
    pin.mutateAsync({ id: c.id, pinned: next }).then(
      () => toast(next ? "Pinned to the top" : "Unpinned"),
      (e: any) => {
        setPinnedId(before);
        toast.error(e?.message ?? "Couldn't pin that");
      },
    );
  };
  const remove = (c: CommunityComment) => {
    if (replyTo && (replyTo.id === c.id || replyTo.threadId === c.id)) setReplyTo(null);
    del.mutateAsync(c).then(
      () => toast("Comment deleted"),
      (e: any) => toast.error(e?.message ?? "Couldn't delete that"),
    );
  };
  const replyCount = (c: CommunityComment) => comments.filter((x) => x.parent_id === c.id).length;
  const toProfile = onOpenPerson
    ? (a: CommunityAuthor) => {
        close();
        onOpenPerson(a);
      }
    : undefined;

  const placeholder = replyTo ? `Reply to ${replyTo.mine ? "yourself" : replyTo.name.split(" ")[0]}…` : "Add a comment…";
  const first = post.author.name.split(" ")[0];

  return (
    <>
      {/* the story above it: a tap there closes the panel (and never steps the story) */}
      <div
        className={cn("absolute inset-0 z-[45] bg-black/30 transition-opacity duration-200 motion-reduce:transition-none", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={close}
        aria-hidden
        data-story-comments-scrim
      />
      <div
        ref={setPanel}
        role="dialog"
        aria-modal={false}
        aria-label={`Comments on ${post.is_mine ? "your" : `${first}'s`} story`}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "dark absolute inset-x-0 z-50 flex max-h-[64%] flex-col rounded-t-[22px] bg-zinc-950/[0.94] text-white shadow-[0_-8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          !open && "pointer-events-none",
        )}
        style={{ bottom: lift, transform: open ? "translate3d(0,0,0)" : "translate3d(0,105%,0)", ...(keyboardMax ? { maxHeight: keyboardMax } : null) }}
        data-story-comments-panel
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="shrink-0 pb-1 pt-2">
          <span aria-hidden className="mx-auto block h-1 w-9 rounded-full bg-white/30" />
          <div className="flex items-center gap-2 pl-4 pr-1.5 pt-1.5">
            <h2 className="text-[15px] font-semibold">{visible ? commentCountWords(visible) : "Comments"}</h2>
            {/* public: everyone who can see the story (the field under the story is the private reply) */}
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/75" data-story-comments-public>
              <Globe2 className="h-3 w-3" aria-hidden /> Public
            </span>
            <button type="button" onClick={close} className="ml-auto grid h-10 w-10 place-items-center rounded-full text-white/85 active:bg-white/10" aria-label="Close comments" data-story-comments-close>
              <X className="h-[22px] w-[22px]" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2" data-story-comments-list>
          {list.isLoading ? (
            <div className="space-y-3.5 py-2" aria-label="Loading comments">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="h-7 w-7 shrink-0 jf-skeleton rounded-full bg-white/10" />
                  <div className="flex-1 space-y-1.5 pt-0.5">
                    <div className="h-2.5 w-20 jf-skeleton rounded bg-white/10" />
                    <div className={cn("h-2.5 jf-skeleton rounded bg-white/10", i ? "w-1/2" : "w-3/4")} />
                  </div>
                </div>
              ))}
            </div>
          ) : list.isError && comments.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-white/70">
              Couldn't load comments.{" "}
              <button type="button" className="font-semibold text-white underline" onClick={() => void list.refetch()}>
                Try again
              </button>
            </p>
          ) : comments.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-white/60" data-story-comments-empty>
              No comments yet
            </p>
          ) : (
            threads.map(({ comment, replies }) => {
              const all = expanded.has(comment.id) || replies.length <= REPLIES_SHOWN + 1;
              const shown = all ? replies : replies.slice(-REPLIES_SHOWN);
              return (
                <div key={comment.id}>
                  <StoryCommentRow c={comment} pinned={comment.id === pinnedId && !comment.hidden} url={urlFor(comment, urls)} progress={progress[comment.id]} onReply={startReply} onLike={toggleLike} onHold={setMenuFor} onOpenMedia={setViewing} onOpenPerson={toProfile} />
                  {replies.length > 0 && (
                    <div className="ml-10">
                      {!all && (
                        <button type="button" onClick={() => setExpanded((s) => new Set(s).add(comment.id))} className="flex h-7 items-center gap-2.5 text-[12px] font-semibold text-white/60">
                          <span className="h-px w-5 bg-white/30" /> View {replies.length - shown.length} more {replies.length - shown.length === 1 ? "reply" : "replies"}
                        </button>
                      )}
                      {shown.map((r) => (
                        <StoryCommentRow key={r.id} c={r} reply url={urlFor(r, urls)} progress={progress[r.id]} onReply={startReply} onLike={toggleLike} onHold={setMenuFor} onOpenMedia={setViewing} onOpenPerson={toProfile} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* the composer: stickers in one tap, then one box with the GIF, photo and mic (send once there's something) */}
        <div className="shrink-0 border-t border-white/10 px-3 pt-1.5" style={{ paddingBottom: lift ? "0.5rem" : "max(env(safe-area-inset-bottom), 0.6rem)" }} data-story-comments-composer>
          {!recorder.recording && (
            <div className="flex items-center justify-between" data-story-comment-stickers>
              {STORY_COMMENT_STICKERS.map((e) => (
                <button
                  key={e}
                  type="button"
                  // keeps the keyboard where it is
                  onPointerDown={(ev) => ev.preventDefault()}
                  // empty box: it goes as a sticker; mid-sentence: it goes in at the cursor
                  onClick={() => (body || picked || gif || voice ? addEmoji(e) : send(e))}
                  className="grid h-10 min-w-0 flex-1 place-items-center rounded-full text-[22px] leading-none active:scale-90"
                  aria-label={body ? `Add ${e}` : `Comment ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {replyTo && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-white/10 px-3 py-1 text-[12px] text-white/70">
              <span className="truncate">
                Replying to <span className="font-semibold text-white">{replyTo.mine ? "yourself" : replyTo.name}</span>
              </span>
              <button type="button" onClick={() => setReplyTo(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full" aria-label="Cancel reply">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {(gif || voice || picked) && (
            <div className="relative mb-2 inline-block" data-story-comment-attachment>
              {gif ? (
                <SentMediaView m={{ kind: gif.kind, url: gif.url, preview: gif.preview, still: gif.still, width: gif.width, height: gif.height, title: gif.title }} max={72} />
              ) : voice ? (
                <VoiceMemoPlayer src={voice.url} duration={voice.duration} />
              ) : picked?.kind === "video" ? (
                <video src={`${picked.previewUrl}#t=0.1`} muted playsInline preload="metadata" className="h-16 w-16 rounded-xl bg-white/10 object-cover" />
              ) : picked ? (
                <img src={picked.previewUrl} alt="" className="h-16 w-16 rounded-xl bg-white/10 object-cover" />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  releasePicked(pickedRef.current);
                  setPicked(null);
                  setGif(null);
                  setVoice(null);
                }}
                className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-black"
                aria-label="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
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
          {recorder.recording ? (
            <RecordingBar meter={recorder.meter} onCancel={recorder.cancel} onDone={() => void recorder.finish()} />
          ) : (
            <div className="flex items-end gap-2">
              <UserAvatar src={me.avatar_url} name={me.name} size={30} expandable={false} className="mb-[7px]" />
              <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-[22px] border border-white/20 bg-white/[0.06] pl-3.5 pr-1 focus-within:border-white/45" data-story-comment-box>
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, COMMENT_MAX))}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  enterKeyHint="send"
                  placeholder={placeholder}
                  className="max-h-28 min-h-0 flex-1 resize-none bg-transparent py-[10px] text-[16px] leading-6 text-white outline-none [field-sizing:content] placeholder:text-white/55 md:text-[15px]"
                  aria-label={replyTo ? "Write a public reply" : "Add a public comment"}
                  data-story-comment-input
                />
                <div className="flex shrink-0 items-center py-[3px]">
                  <button type="button" onClick={() => setGifOpen(true)} className="grid h-9 w-9 place-items-center rounded-full text-[10px] font-bold text-white/70" aria-label="Add a GIF or sticker">
                    <span className="rounded-[5px] border-[1.5px] border-current px-[3px] leading-[14px]">GIF</span>
                  </button>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={picking} className="grid h-9 w-9 place-items-center rounded-full text-white/70" aria-label="Add a photo or video">
                    {picking ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-[21px] w-[21px]" strokeWidth={1.75} />}
                  </button>
                  {canSend ? (
                    <button
                      type="button"
                      // the keyboard stays up for the next one (Instagram's)
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => send()}
                      className="relative ml-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black active:scale-90"
                      aria-label="Post comment"
                      data-story-comment-send
                    >
                      <ArrowUp className="h-5 w-5" strokeWidth={2.25} />
                      <HapticTap />
                    </button>
                  ) : (
                    <MicButton onClick={() => void recorder.start()} disabled={!user?.id || picking} quiet className="text-white/70" />
                  )}
                </div>
              </div>
            </div>
          )}
          <GifPicker
            hideTrigger
            asDialog
            showSounds={false}
            controlledOpen={gifOpen}
            onControlledOpenChange={setGifOpen}
            onPick={(g) => {
              releasePicked(pickedRef.current);
              setPicked(null);
              setVoice(null);
              setGif(g);
              setGifOpen(false);
            }}
          />
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
        canPin={(c) => post.is_mine && !c.parent_id && !c.hidden && !c.pending}
        pinnedId={pinnedId}
        onPin={togglePin}
        canReport={(c) => !c.is_mine && !c.pending && !viewerIsStaff && !isImpersonating}
        onReport={(c) => {
          setReportFor(c);
          setReporting(true);
        }}
      />
      {reportFor && <ReportSheet kind="comment" targetId={reportFor.id} author={reportFor.author} postId={post.id} open={reporting} onOpenChange={setReporting} />}
      <ShareCommentSheet c={shareFor} onClose={() => setShareFor(null)} postAuthor={post.author.name} />
      {trimmer.element}
      <MediaViewer c={viewing} thumbUrl={viewing ? urlFor(viewing, urls) : null} onClose={() => setViewing(null)} />
      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFor && !deleteFor.is_mine ? `${deleteFor.author.name.split(" ")[0]}'s comment is removed for everyone.` : "It's gone for everyone."}
              {deleteFor && replyCount(deleteFor) > 0 ? ` Its ${replyCount(deleteFor) === 1 ? "reply goes" : `${replyCount(deleteFor)} replies go`} too.` : ""}
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

/** One comment in a story's panel: compact and on the dark glass (the feed's own row is for the feed). */
function StoryCommentRow({
  c,
  reply = false,
  pinned = false,
  url,
  progress,
  onReply,
  onLike,
  onHold,
  onOpenMedia,
  onOpenPerson,
}: {
  c: CommunityComment;
  reply?: boolean;
  pinned?: boolean;
  url: string | null;
  progress?: number;
  onReply: (c: CommunityComment) => void;
  onLike: (c: CommunityComment) => void;
  onHold: (c: CommunityComment) => void;
  onOpenMedia: (c: CommunityComment) => void;
  onOpenPerson?: (a: CommunityAuthor) => void;
}) {
  const hold = useHold(() => onHold(c), !!c.pending);
  const person = onOpenPerson && !c.pending ? () => onOpenPerson(c.author) : undefined;
  const likes = !c.pending && (c.likes ?? 0) > 0 ? compactNumber(c.likes ?? 0) : "";
  const sticker = !c.media && !c.reply_to && isStickerText(c.body);
  const size = reply ? 24 : 30;
  return (
    <div
      {...hold.handlers}
      tabIndex={c.pending ? -1 : 0}
      data-story-comment-id={c.id}
      aria-label={`${c.author.name}: ${c.body || mediaWord(c)}. Hold for options.`}
      className={cn(
        "-mx-2 flex select-none items-start gap-2.5 rounded-xl px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        hold.pressing && "bg-white/10",
        (c.pending || c.hidden) && "opacity-60",
      )}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}
    >
      {person ? (
        <button type="button" data-no-hold onClick={person} className="mt-0.5 shrink-0 rounded-full active:scale-95" aria-label={`Open ${c.author.name}'s profile`}>
          <UserAvatar src={c.author.avatar_url} name={c.author.name} size={size} expandable={false} />
        </button>
      ) : (
        <UserAvatar src={c.author.avatar_url} name={c.author.name} size={size} expandable={false} className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5">
          {person ? (
            <button type="button" data-no-hold onClick={person} className="min-w-0 truncate text-left font-semibold active:opacity-70">
              {c.author.name}
            </button>
          ) : (
            <span className="min-w-0 truncate font-semibold">{c.author.name}</span>
          )}
          <NameMarks person={c.author} userId={c.author.user_id} size={13} onDark />
          <span className="shrink-0 text-[11.5px] text-white/50">
            {c.pending ? (progress != null && progress < 100 ? `Uploading ${progress}%` : "Posting…") : postTimeLabel(c.created_at)}
          </span>
          {pinned && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-white/50">
              <Pin className="h-3 w-3 rotate-45" /> Pinned
            </span>
          )}
        </div>
        {sticker ? (
          <p className="mt-0.5 text-[34px] leading-[40px]" data-story-comment-sticker>
            {c.body}
          </p>
        ) : (
          (c.body || c.reply_to) && (
            <p className="whitespace-pre-line break-words text-[14px] leading-[1.4] text-white/95" data-story-comment-body>
              {c.reply_to && <span className="font-semibold">@{c.reply_to} </span>}
              {c.body}
            </p>
          )
        )}
        {c.media && <CommentMedia c={c} url={url} onOpen={onOpenMedia} />}
        {!c.pending && (
          <div className="mt-0.5 flex items-center gap-3 text-[11.5px] font-semibold text-white/55">
            <button type="button" data-no-hold onClick={() => onReply(c)} className="-my-1 py-1 active:text-white">
              Reply
            </button>
            {c.hidden && <span className="text-[11px] font-medium">Hidden</span>}
          </div>
        )}
      </div>
      {!c.pending && (
        <div className="-mr-1 flex w-8 shrink-0 flex-col items-center">
          <button
            type="button"
            data-no-hold
            onClick={() => onLike(c)}
            aria-pressed={!!c.liked}
            aria-label={c.liked ? "Unlike comment" : "Like comment"}
            className="grid h-8 w-8 place-items-center rounded-full active:scale-90"
            data-story-comment-like
          >
            <Heart className={cn("h-[16px] w-[16px] transition-transform", c.liked ? "scale-110 fill-[#ef3340] text-[#ef3340]" : "text-white/60")} strokeWidth={1.9} />
          </button>
          {likes && <span className="-mt-1 text-[10.5px] leading-4 text-white/55 tabular-nums">{likes}</span>}
        </div>
      )}
    </div>
  );
}
