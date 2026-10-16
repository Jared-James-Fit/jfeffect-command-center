import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, Plus, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useCommunityProfile, useHintsSeen, useMarkHintSeen, usePostMediaUrls } from "@/lib/community.queries";
import { useAlbumPosts, useCreateAlbum, useRepost, useSavedOverview, useSavePost, type SaveCover } from "@/lib/community-saves";
import {
  REPOST_NOTE_EMOJI,
  REPOST_NOTE_MAX,
  cleanRepostNote,
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
    {noteOpen && <RepostNoteSheet post={post} open={noteOpen} onOpenChange={setNoteOpen} />}
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
 * The note on a repost, floating on the post with its person's photo
 * (Instagram's). Only emoji show big. Yours can be tapped to change it; right
 * after you repost, an empty one asks for a note and drifts away on its own.
 */
export function RepostNoteBubble({ who, note, onTap, ask = false, className }: {
  who: Pick<CommunityAuthor, "name" | "avatar_url">;
  note: string | null;
  onTap?: () => void;
  ask?: boolean;
  className?: string;
}) {
  const big = isEmojiOnly(note);
  const body = (
    <>
      <span className="shrink-0 rounded-full ring-2 ring-white/90 shadow-md">
        <UserAvatar src={who.avatar_url} name={who.name} size={26} expandable={false} />
      </span>
      <span
        className={cn(
          "relative -ml-1 max-w-[min(15rem,70vw)] rounded-2xl rounded-bl-md bg-white px-3 py-1.5 text-left text-black shadow-[0_8px_22px_-8px_rgba(0,0,0,0.55)]",
          big ? "text-[22px] leading-none" : "text-[13px] font-semibold leading-snug",
          ask && "text-black/55",
        )}
      >
        <span className="line-clamp-2 break-words">{ask ? "Add a note…" : note}</span>
      </span>
    </>
  );
  const cls = cn("repost-note pointer-events-auto flex items-end gap-0 [touch-action:manipulation]", ask && "repost-note-ask", className);
  return onTap ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className={cls}
      aria-label={ask ? "Add a note to your repost" : `Your note: ${note}. Tap to change it`}
      data-repost-note={ask ? "ask" : "mine"}
    >
      {body}
    </button>
  ) : (
    <div className={cls} aria-label={`${who.name}: ${note}`} data-repost-note="theirs">
      {body}
    </div>
  );
}

/** Write (or change) the note on your repost: a line and quick emoji, with a live preview. */
export function RepostNoteSheet({ post, open, onOpenChange }: { post: CommunityPost; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(open ? (user?.id ?? null) : null);
  const repost = useRepost();
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText(post.my_repost?.note ?? "");
  }, [open, post.my_repost?.note]);
  const had = !!post.my_repost?.note;
  const clean = cleanRepostNote(text);
  const left = REPOST_NOTE_MAX - [...text].length;
  const done = (note: string | null) =>
    repost.mutate(
      { post, on: true, note },
      {
        onError: (e: any) => toast.error(e?.message ?? "Couldn't save your note. Try again."),
        onSuccess: () => onOpenChange(false),
      },
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[420px]" style={KEYBOARD_SAFE} data-repost-note-sheet>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="px-5 pt-3">
          <SheetTitle className="text-[16px] font-black">{had ? "Your note" : "Add a note"}</SheetTitle>
          <SheetDescription className="mt-0.5 text-[12px] leading-snug text-muted-foreground">It floats on the post for the people who see your repost.</SheetDescription>
        </div>
        {/* what they'll see */}
        <div className="mx-5 mt-3 flex min-h-[64px] items-center rounded-2xl bg-[radial-gradient(120%_120%_at_0%_0%,rgba(239,51,64,0.35),#111114_70%)] px-3 py-3">
          <RepostNoteBubble who={{ name: me?.author.name ?? "You", avatar_url: me?.author.avatar_url ?? null }} note={clean ?? "…"} />
        </div>
        <form
          className="px-5 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            done(clean);
          }}
        >
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={text}
              onChange={(e) => setText([...e.target.value.replace(/\n/g, " ")].slice(0, REPOST_NOTE_MAX).join(""))}
              placeholder="Say why it's worth seeing"
              enterKeyHint="done"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"
              aria-label="Repost note"
              data-repost-note-input
            />
            <span className={cn("w-7 shrink-0 text-right text-[11px] font-bold tabular-nums", left < 10 ? "text-primary" : "text-muted-foreground")}>{left}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Quick emoji">
            {REPOST_NOTE_EMOJI.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setText((t) => [...`${t}${em}`].slice(0, REPOST_NOTE_MAX).join(""))}
                className="grid h-10 w-10 place-items-center rounded-full bg-muted text-[20px] active:scale-90"
                aria-label={`Add ${em}`}
              >
                {em}
              </button>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            {had && (
              <button type="button" disabled={repost.isPending} onClick={() => done(null)} className="h-11 flex-1 rounded-xl bg-muted text-[14px] font-bold active:bg-muted/70" data-remove-note>
                Remove note
              </button>
            )}
            <button type="submit" disabled={repost.isPending || (!clean && !had)} className="h-11 flex-1 rounded-xl bg-primary text-[14px] font-bold text-primary-foreground disabled:opacity-50" data-save-note>
              {repost.isPending ? "Saving…" : "Done"}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The floating note on a post card, and "Add a note" right after you
 * repost. Yours first (tap to change); otherwise the first reposter's who
 * wrote one. Sits on a photo's top-left corner; on a post that's words, it
 * sits above them so it never covers them.
 */
export function useRepostNote(post: CommunityPost) {
  const { user } = useAuth();
  const { data: me } = useCommunityProfile(post.my_repost ? (user?.id ?? null) : null);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  // "Add a note…" floats up after reposting, then drifts off if it's ignored
  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 6000);
    return () => window.clearTimeout(t);
  }, [asking]);
  useEffect(() => {
    if (!post.my_repost) setAsking(false);
  }, [post.my_repost]);
  const myNote = post.my_repost?.note ?? null;
  const theirs = (post.reposted_by ?? []).find((r) => !r.is_me && !!r.note?.trim()) ?? null;
  const meWho = { name: me?.author.name ?? "You", avatar_url: me?.author.avatar_url ?? null };
  const bubble = post.my_repost && (myNote || asking)
    ? <RepostNoteBubble who={meWho} note={myNote} ask={!myNote} onTap={() => { setAsking(false); setEditing(true); }} />
    : theirs
      ? <RepostNoteBubble who={theirs} note={theirs.note} />
      : null;
  const sheet = post.my_repost || editing ? <RepostNoteSheet post={post} open={editing} onOpenChange={setEditing} /> : null;
  return { bubble, sheet, ask: () => setAsking(true) };
}
