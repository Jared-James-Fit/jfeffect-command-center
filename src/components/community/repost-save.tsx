import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Plus, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useCommunityProfile, useHintsSeen, useMarkHintSeen, usePostMediaUrls } from "@/lib/community.queries";
import { RepostNoteEditor } from "@/components/community/repost-note-editor";
import { useAlbumPosts, useCreateAlbum, useRepost, useSavedOverview, useSavePost, type SaveCover } from "@/lib/community-saves";
import {
  floatingNote,
  isEmojiOnly,
  repostedLine,
  showRepostButton,
  type CommunityAuthor,
  type CommunityPost,
} from "@/lib/community";

const HOLD_MS = 420;
/** A sheet with a text box sits on the iPhone keyboard, never under it. */
const KEYBOARD_SAFE = { bottom: "var(--keyboard-inset, 0px)" } as const;
const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptics here */
  }
};

/**
 * 🔁 under a post. Tap: it's reposted to your followers and an "Add a note"
 * bubble floats up on the post (Instagram's). Tap again: the repost is
 * taken back, with Undo. Not on your own posts, an automatic story, or a
 * post that isn't shared with the whole crew.
 */
export function RepostButton({ post, onReposted }: { post: CommunityPost; onReposted?: () => void }) {
  const repost = useRepost();
  const [pop, setPop] = useState(0);
  // no card around it to float "Add a note…" on (a post's own page): the toast offers it
  const [noteOpen, setNoteOpen] = useState(false);
  const { isImpersonating } = useClientImpersonation();
  if (isImpersonating || !showRepostButton(post)) return null;
  const mine = !!post.my_repost;
  const count = post.repost_count ?? 0;
  const fail = (e: any) => toast.error(e?.message ?? "That didn't work. Try again.");
  const tap = () => {
    if (mine) {
      const note = post.my_repost?.note ?? null;
      repost.mutate(
        { post, on: false },
        {
          onError: fail,
          onSuccess: () =>
            toast("Repost removed", {
              action: { label: "Undo", onClick: () => repost.mutate({ post: { id: post.id, my_repost: null }, on: true, note }, { onError: fail }) },
            }),
        },
      );
      return;
    }
    setPop((n) => n + 1);
    buzz(8);
    repost.mutate({ post, on: true }, { onError: fail });
    if (onReposted) onReposted();
    else toast("Reposted", { action: { label: "Add a note", onClick: () => setNoteOpen(true) } });
  };
  return (
    <>
    <button
      type="button"
      onClick={tap}
      aria-pressed={mine}
      aria-label={`${mine ? "Reposted. Tap to undo" : "Repost to your followers"}${count ? `, ${count}` : ""}`}
      className="flex h-11 min-w-11 shrink-0 select-none items-center justify-center gap-1 rounded-full px-2 [touch-action:manipulation] hover:bg-muted active:scale-90"
      data-repost-button={mine ? "on" : "off"}
    >
      <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
        <Repeat2 className={cn("h-[23px] w-[23px]", mine ? "text-emerald-500" : "text-foreground/80")} strokeWidth={mine ? 2.6 : 2} />
      </span>
      {count > 0 && <span className={cn("text-[13px] font-black tabular-nums", mine ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{count}</span>}
    </button>
    {/* beside the button, never inside it: taps in the sheet must not reach the button */}
    {noteOpen && <RepostNoteEditor post={post} onClose={() => setNoteOpen(false)} />}
    </>
  );
}

/**
 * 🔖 at the end of the row. Tap saves it (only you ever see Saved), with
 * "Save to album"; hold opens the albums straight away. Tap a saved one to
 * unsave it (out of its albums too), with Undo that puts it back where it was.
 */
export function SaveButton({ post }: { post: CommunityPost }) {
  const save = useSavePost();
  const albumPosts = useAlbumPosts();
  const [picker, setPicker] = useState(false);
  const [pop, setPop] = useState(0);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const { data: hints } = useHintsSeen();
  const markHint = useMarkHintSeen();
  const { isImpersonating } = useClientImpersonation();
  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  if (isImpersonating) return null;
  const saved = !!post.saved;
  const fail = (e: any) => toast.error(e?.message ?? "That didn't work. Try again.");

  const doSave = () => {
    setPop((n) => n + 1);
    buzz(8);
    // the first time, say it's private (remembered on the account)
    const first = !hints?.includes("saved_private");
    if (first) markHint("saved_private");
    save.mutate({ post, on: true }, { onError: fail });
    toast("Saved", {
      description: first ? "Only you can see what you save. Find it on your profile." : undefined,
      action: { label: "Save to album", onClick: () => setPicker(true) },
    });
  };
  const doUnsave = () =>
    save.mutate(
      { post, on: false },
      {
        onError: fail,
        onSuccess: (r) => {
          const albums = r.removed_from ?? [];
          toast(albums.length ? "Removed from Saved and its albums" : "Removed from Saved", {
            action: {
              label: "Undo",
              onClick: () =>
                save.mutate(
                  { post, on: true },
                  { onError: fail, onSuccess: () => albums.forEach((albumId) => albumPosts.mutate({ albumId, postIds: [post.id], add: true })) },
                ),
            },
          });
        },
      },
    );

  return (
    <>
      <button
        type="button"
        onPointerDown={() => {
          held.current = false;
          cancel();
          timer.current = window.setTimeout(() => {
            timer.current = null;
            held.current = true;
            buzz(10);
            setPicker(true);
          }, HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          held.current = true;
          setPicker(true);
        }}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          if (saved) doUnsave();
          else doSave();
        }}
        aria-pressed={saved}
        aria-label={saved ? "Saved. Tap to remove, hold for albums" : "Save. Hold to pick an album"}
        className="grid h-11 w-11 shrink-0 select-none place-items-center rounded-full [-webkit-touch-callout:none] [touch-action:manipulation] hover:bg-muted active:scale-90"
        data-save-button={saved ? "on" : "off"}
      >
        <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
          <Bookmark className={cn("h-[23px] w-[23px]", saved ? "fill-foreground text-foreground" : "text-foreground/80")} strokeWidth={2} />
        </span>
      </button>
      <AlbumPickerSheet post={post} open={picker} onOpenChange={setPicker} />
    </>
  );
}

/** A tile's picture: the post's photo, else a few of its words on the brand tint. */
export function CoverFace({ cover, url, className }: { cover: SaveCover | undefined; url: string | null | undefined; className?: string }) {
  if (!cover) return <div className={cn("bg-muted", className)} />;
  if (url) return <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className={cn("h-full w-full object-cover", className)} />;
  return (
    <div className={cn("flex h-full w-full items-end bg-[radial-gradient(120%_90%_at_90%_0%,rgba(239,51,64,0.45),#111114_65%)] p-1.5 text-left text-white", className)}>
      <span className="line-clamp-3 text-[9px] font-semibold leading-snug">{cover.text ?? (cover.kind === "workout" ? "Workout" : "Post")}</span>
    </div>
  );
}

/** Signed photos for a set of covers (one storage call). */
export function useCoverUrls(covers: SaveCover[]): Record<string, string> {
  const fake = covers.map((c) => ({ media_thumb_path: c.path, media_type: null, media_path: null })) as unknown as CommunityPost[];
  const { data } = usePostMediaUrls(fake);
  return data ?? {};
}

/**
 * "Save to album": your albums (a tick on the ones holding this post; tap
 * to put it in or take it out) and New album. Putting it in an album saves it.
 */
export function AlbumPickerSheet({ post, open, onOpenChange }: { post: Pick<CommunityPost, "id" | "saved">; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useSavedOverview(open, post.id);
  const albumPosts = useAlbumPosts();
  const create = useCreateAlbum();
  const save = useSavePost();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const albums = data?.albums ?? [];
  const urls = useCoverUrls(albums.flatMap((a) => a.covers.slice(0, 1)));
  useEffect(() => {
    if (!open) {
      setNaming(false);
      setName("");
    }
  }, [open]);
  const fail = (e: any) => toast.error(e?.message ?? "That didn't work. Try again.");
  const make = () => {
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { name: n, postIds: [post.id] },
      {
        onError: fail,
        onSuccess: (a) => {
          if (!post.saved) save.mutate({ post, on: true }); // it's saved now: the bookmark fills
          toast(`Saved to ${a.name}`);
          onOpenChange(false);
        },
      },
    );
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[420px]" style={KEYBOARD_SAFE} data-album-picker>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <SheetTitle className="text-[16px] font-black">Save to album</SheetTitle>
          <button type="button" onClick={() => setNaming(true)} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-bold text-primary active:bg-muted" data-new-album>
            <Plus className="h-4 w-4" /> New album
          </button>
        </div>
        <SheetDescription className="px-5 pb-2 text-[12px] text-muted-foreground">Only you can see your albums.</SheetDescription>
        {naming && (
          <form
            className="flex items-center gap-2 px-5 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              make();
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              maxLength={40}
              placeholder="Album name (Form tips, Meal ideas…)"
              enterKeyHint="done"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"
              aria-label="Album name"
              data-album-name
            />
            <button type="submit" disabled={!name.trim() || create.isPending} className="h-11 shrink-0 rounded-xl bg-primary px-4 text-[14px] font-bold text-primary-foreground disabled:opacity-50">
              {create.isPending ? "…" : "Create"}
            </button>
          </form>
        )}
        <div className="max-h-[50vh] overflow-y-auto pb-1">
          {isLoading && <div className="px-5 py-6 text-center text-[13px] text-muted-foreground">Loading…</div>}
          {!isLoading && albums.length === 0 && !naming && (
            <button type="button" onClick={() => setNaming(true)} className="mx-5 mb-2 flex w-[calc(100%-2.5rem)] items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-4 text-left active:bg-muted">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted"><Plus className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold">Make your first album</span>
                <span className="block text-[12px] text-muted-foreground">Sort what you save: form tips, programs, meals.</span>
              </span>
            </button>
          )}
          {albums.map((a) => {
            const on = !!a.has_post;
            return (
              <button
                key={a.id}
                type="button"
                disabled={albumPosts.isPending}
                onClick={() =>
                  albumPosts.mutate(
                    { albumId: a.id, postIds: [post.id], add: !on },
                    {
                      onError: fail,
                      onSuccess: () => {
                        if (!on && !post.saved) save.mutate({ post, on: true });
                        toast(on ? `Removed from ${a.name}` : `Saved to ${a.name}`);
                      },
                    },
                  )
                }
                className="flex w-full items-center gap-3 px-5 py-2 text-left active:bg-muted"
                aria-pressed={on}
                data-album-row={a.name}
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <CoverFace cover={a.covers[0]} url={a.covers[0]?.path ? urls[a.covers[0].path] : null} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{a.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{a.count} {a.count === 1 ? "post" : "posts"}</span>
                </span>
                <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        <SheetClose className="mt-1 h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Done</SheetClose>
      </SheetContent>
    </Sheet>
  );
}

/** "🔁 Vicky reposted" over a post someone reposted (names open their profiles). */
export function RepostedHeader({ post, onOpenAuthor }: { post: CommunityPost; onOpenAuthor?: (a: CommunityAuthor) => void }) {
  const line = repostedLine(post);
  const first = post.reposted_by?.[0];
  if (!line || !first) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-3.5 pt-2.5 text-[12px] font-semibold text-muted-foreground" data-reposted-by>
      <Repeat2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
      {onOpenAuthor && !first.is_me ? (
        <button type="button" onClick={() => onOpenAuthor(first)} className="min-w-0 truncate text-left">
          {line}
        </button>
      ) : (
        <span className="min-w-0 truncate">{line}</span>
      )}
    </div>
  );
}

/**
 * A repost on the post, Instagram's way: the reposter's photo in the bottom
 * left corner with a small 🔁 badge, and their note (words or emoji) in a
 * bubble above it. Only emoji show big. Yours can be tapped to add or change
 * the note; right after you repost, an empty bubble asks for one and drifts
 * off on its own. `inline` (a post that's words) puts the bubble beside the
 * photo instead of above it, so it never covers the words.
 */
export function RepostStamp({ who, note, onTap, mine = false, ask = false, inline = false, className, label }: {
  who: Pick<CommunityAuthor, "name" | "avatar_url">;
  note: string | null;
  onTap?: () => void;
  /** Your own repost (tap: your note). */
  mine?: boolean;
  ask?: boolean;
  inline?: boolean;
  className?: string;
  label?: string;
}) {
  const text = ask ? null : note?.trim() || null;
  const big = isEmojiOnly(text);
  const bubble = text || ask ? (
    <span
      key={`${text ?? ""}${ask}`}
      className={cn("repost-note relative block w-max", ask && "repost-note-ask", inline ? "ml-1.5" : "mb-1.5 ml-1")}
      data-repost-bubble
    >
      <span
        className={cn(
          "block max-w-[min(16.5rem,68vw)] rounded-[18px] bg-white/95 px-3 py-[7px] text-center text-black shadow-[0_6px_20px_-6px_rgba(0,0,0,0.55)] backdrop-blur",
          big ? "text-[24px] leading-[1.05]" : "text-[13px] font-semibold leading-snug",
          ask && "font-bold text-black/50",
        )}
      >
        <span className="line-clamp-6 whitespace-pre-line break-words">{ask ? "Add a note…" : text}</span>
      </span>
      {/* the thought tail, down to the photo (beside it, inline) */}
      {inline ? (
        <span className="absolute -left-1 bottom-2 h-2.5 w-2.5 rounded-full bg-white/95 shadow" aria-hidden />
      ) : (
        <>
          <span className="absolute -bottom-1.5 left-3 h-2.5 w-2.5 rounded-full bg-white/95 shadow" aria-hidden />
          <span className="absolute -bottom-[11px] left-[9px] h-1.5 w-1.5 rounded-full bg-white/95 shadow" aria-hidden />
        </>
      )}
    </span>
  ) : null;
  const face = (
    <span className="relative block shrink-0">
      <span className="block rounded-full ring-2 ring-white shadow-[0_4px_14px_-4px_rgba(0,0,0,0.6)]">
        <UserAvatar src={who.avatar_url} name={who.name} size={inline ? 30 : 38} expandable={false} />
      </span>
      <span className="absolute -bottom-0.5 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-white" aria-hidden>
        <Repeat2 className="h-[11px] w-[11px]" strokeWidth={3} />
      </span>
    </span>
  );
  const body = inline ? (
    <span className="flex items-center">
      {face}
      {bubble}
    </span>
  ) : (
    <span className="flex flex-col items-start">
      {bubble}
      {face}
    </span>
  );
  const cls = cn("pointer-events-auto block text-left [touch-action:manipulation]", className);
  return onTap ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className={cls}
      aria-label={label ?? (ask || !text ? "Add a note to your repost" : `Your note: ${text}. Tap to change it`)}
      data-repost-note={mine ? (ask ? "ask" : "mine") : "theirs"}
    >
      {body}
    </button>
  ) : (
    <div className={cls} aria-label={label ?? `${who.name} reposted${text ? `: ${text}` : ""}`} data-repost-note="theirs">
      {body}
    </div>
  );
}

/**
 * The repost stamp on a post card: yours (always, once you've reposted: tap
 * to add or change your note; "Add a note…" asks right after reposting), else
 * the first reposter's who wrote a note (tap: their profile). Sits in the
 * picture's bottom-left corner; on a post that's words, above them so it
 * never covers them.
 */
export function useRepostNote(post: CommunityPost, opts: { preview?: string | null; onOpenAuthor?: (a: CommunityAuthor) => void; inline?: boolean } = {}) {
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(post.my_repost ? (user?.id ?? null) : null);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  // "Add a note…" floats up after reposting, then drifts off if it's ignored
  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 8000);
    return () => window.clearTimeout(t);
  }, [asking]);
  useEffect(() => {
    if (!post.my_repost) setAsking(false);
  }, [post.my_repost]);
  const myNote = post.my_repost?.note ?? null;
  const theirs = floatingNote(post);
  const meWho = { name: me?.author.name ?? "You", avatar_url: me?.author.avatar_url ?? null };
  const open = opts.onOpenAuthor;
  const bubble = post.my_repost ? (
    <RepostStamp mine who={meWho} note={myNote} ask={!myNote && asking} inline={opts.inline} onTap={() => { setAsking(false); setEditing(true); }} />
  ) : theirs ? (
    <RepostStamp
      who={theirs}
      note={theirs.note}
      inline={opts.inline}
      onTap={open ? () => open(theirs) : undefined}
      label={`${theirs.name} reposted: ${theirs.note}. Open their profile`}
    />
  ) : null;
  const sheet = editing && post.my_repost ? <RepostNoteEditor post={post} onClose={() => setEditing(false)} preview={opts.preview ?? null} /> : null;
  return { bubble, sheet, ask: () => setAsking(true) };
}
