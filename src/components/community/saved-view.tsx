import { useEffect, useMemo, useState } from "react";
import { Bookmark, ChevronLeft, Lock, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { GridSkeleton, PostGrid } from "@/components/community/post-grid";
import { CoverFace, useCoverUrls } from "@/components/community/repost-save";
import { usePostMediaUrls } from "@/lib/community.queries";
import {
  useAlbumPosts,
  useCreateAlbum,
  useDeleteAlbum,
  useRenameAlbum,
  useSavedOverview,
  useSavedPosts,
  useSavePost,
  useUserReposts,
  type SaveCover,
  type SavedAlbum,
} from "@/lib/community-saves";
import type { CommunityPost } from "@/lib/community";

const KEYBOARD_SAFE = { bottom: "var(--keyboard-inset, 0px)" } as const;
const SHEET = "gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[420px]";
const fail = (e: any) => toast.error(e?.message ?? "That didn't work. Try again.");

type Open = { id: string | null; name: string };

/**
 * Your Saved (Instagram's): All posts and your albums as tiles, each with its
 * latest four. Open one for its grid; Select to sort many at once (add to an
 * album, take out of one, unsave). Only you ever see any of it.
 */
export function SavedView({ unit, onOpenPost }: { unit: "kg" | "lb"; onOpenPost: (p: CommunityPost) => void }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [naming, setNaming] = useState(false);
  const { data, isLoading } = useSavedOverview(true);
  const covers = useMemo(() => [...(data?.all.covers ?? []), ...(data?.albums ?? []).flatMap((a) => a.covers)], [data]);
  const urls = useCoverUrls(covers);

  // an album that's gone (deleted on another phone) closes
  useEffect(() => {
    if (open?.id && data && !data.albums.some((a) => a.id === open.id)) setOpen(null);
  }, [data, open?.id]);

  if (open) {
    const album = open.id ? data?.albums.find((a) => a.id === open.id) ?? null : null;
    return <SavedGrid album={album} name={album?.name ?? open.name} unit={unit} onOpenPost={onOpenPost} onBack={() => setOpen(null)} />;
  }
  return (
    <div data-saved-view>
      <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        <Lock className="h-3.5 w-3.5" aria-hidden /> Only you can see what you save.
      </p>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <AlbumTile name="All posts" count={data?.all.count ?? 0} covers={data?.all.covers ?? []} urls={urls} onOpen={() => setOpen({ id: null, name: "All posts" })} />
          {(data?.albums ?? []).map((a) => (
            <AlbumTile key={a.id} name={a.name} count={a.count} covers={a.covers} urls={urls} onOpen={() => setOpen({ id: a.id, name: a.name })} />
          ))}
          <button type="button" onClick={() => setNaming(true)} className="text-left" data-new-album-tile>
            <span className="grid aspect-square w-full place-items-center rounded-2xl border-2 border-dashed border-border text-muted-foreground active:bg-muted">
              <span className="flex flex-col items-center gap-1">
                <Plus className="h-6 w-6" />
                <span className="text-[12px] font-bold">New album</span>
              </span>
            </span>
          </button>
        </div>
      )}
      {!isLoading && (data?.all.count ?? 0) === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-border px-6 py-6 text-center text-[13px] text-muted-foreground">
          Tap <Bookmark className="mx-0.5 inline h-3.5 w-3.5 -translate-y-px" aria-label="Save" /> under any post to keep it here. Hold it to put it straight in an album.
        </div>
      )}
      <NameAlbumSheet open={naming} onOpenChange={setNaming} onCreated={(a) => setOpen({ id: a.id, name: a.name })} />
    </div>
  );
}

/** An album as a tile: its latest four (one fills it while it has fewer), its name and how many. */
function AlbumTile({ name, count, covers, urls, onOpen }: { name: string; count: number; covers: SaveCover[]; urls: Record<string, string>; onOpen: () => void }) {
  const four = covers.length >= 4;
  return (
    <button type="button" onClick={onOpen} className="min-w-0 text-left active:opacity-80" data-album-tile={name}>
      <span className={cn("grid aspect-square w-full overflow-hidden rounded-2xl bg-muted", four ? "grid-cols-2 grid-rows-2 gap-px" : "grid-cols-1")}>
        {four
          ? covers.slice(0, 4).map((c) => <CoverFace key={c.id} cover={c} url={c.path ? urls[c.path] : null} />)
          : covers[0]
            ? <CoverFace cover={covers[0]} url={covers[0].path ? urls[covers[0].path] : null} />
            : <span className="grid h-full w-full place-items-center text-muted-foreground"><Bookmark className="h-7 w-7" /></span>}
      </span>
      <span className="mt-1.5 block truncate text-[14px] font-bold">{name}</span>
      <span className="block text-[12px] text-muted-foreground">{count} {count === 1 ? "post" : "posts"}</span>
    </button>
  );
}

/**
 * One album (or All posts): its grid, newest first. Select picks several:
 * from All they go into an album or get unsaved; from an album they come out
 * of it (they stay saved).
 */
function SavedGrid({ album, name, unit, onOpenPost, onBack }: { album: SavedAlbum | null; name: string; unit: "kg" | "lb"; onOpenPost: (p: CommunityPost) => void; onBack: () => void }) {
  const q = useSavedPosts(album?.id ?? null);
  const posts = useMemo(() => q.data?.pages.flatMap((p) => p.posts) ?? [], [q.data]);
  const { data: urls } = usePostMediaUrls(posts);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const albumPosts = useAlbumPosts();
  const save = useSavePost();
  const ids = [...picked];
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const removeFromAlbum = () => {
    if (!album || !ids.length) return;
    albumPosts.mutate({ albumId: album.id, postIds: ids, add: false }, { onError: fail, onSuccess: () => { toast(`Removed ${ids.length} from ${album.name}`); stopSelecting(); } });
  };
  const unsave = async () => {
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => save.mutateAsync({ post: { id }, on: false })));
      toast(ids.length === 1 ? "Removed from Saved" : `Removed ${ids.length} from Saved`);
      stopSelecting();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div data-saved-grid={album ? "album" : "all"}>
      <div className="mb-3 flex min-h-10 items-center gap-1">
        <button type="button" onClick={selecting ? stopSelecting : onBack} className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-muted" aria-label={selecting ? "Stop selecting" : "Back to Saved"}>
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-[17px] font-black">{selecting ? (ids.length ? `${ids.length} selected` : "Select posts") : name}</h3>
        {!selecting && posts.length > 0 && (
          <button type="button" onClick={() => setSelecting(true)} className="h-9 shrink-0 rounded-full px-3 text-[13px] font-bold text-primary active:bg-muted" data-select-posts>
            Select
          </button>
        )}
        {!selecting && album && (
          <button type="button" onClick={() => setMenu(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-muted" aria-label={`Album options for ${album.name}`} data-album-menu>
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      </div>
      {selecting && (
        <div className="mb-3 flex gap-2" data-select-actions>
          {album ? (
            <button type="button" disabled={!ids.length || albumPosts.isPending} onClick={removeFromAlbum} className="h-10 flex-1 rounded-xl bg-muted text-[13px] font-bold disabled:opacity-50">
              Remove from album
            </button>
          ) : (
            <button type="button" disabled={!ids.length} onClick={() => setMoving(true)} className="h-10 flex-1 rounded-xl bg-primary text-[13px] font-bold text-primary-foreground disabled:opacity-50" data-add-to-album>
              Add to album
            </button>
          )}
          <button type="button" disabled={!ids.length || save.isPending} onClick={unsave} className="h-10 flex-1 rounded-xl bg-muted text-[13px] font-bold text-destructive disabled:opacity-50">
            Unsave
          </button>
        </div>
      )}
      {q.isLoading ? (
        <GridSkeleton />
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-8 text-center text-[13px] text-muted-foreground">
          {album ? (
            <>
              <p>Nothing in {album.name} yet.</p>
              <button type="button" onClick={() => setAdding(true)} className="mt-3 inline-flex h-9 items-center gap-1 rounded-full bg-primary px-4 text-[13px] font-bold text-primary-foreground" data-add-from-saved>
                <Plus className="h-4 w-4" /> Add from Saved
              </button>
            </>
          ) : (
            "Nothing saved yet. Tap the bookmark under a post to keep it here."
          )}
        </div>
      ) : (
        <PostGrid posts={posts} urls={urls} unit={unit} picked={selecting ? picked : null} onTap={(p) => (selecting ? toggle(p.id) : onOpenPost(p))} pager={q} />
      )}
      {album && posts.length > 0 && !selecting && (
        <button type="button" onClick={() => setAdding(true)} className="mt-3 inline-flex h-9 items-center gap-1 rounded-full px-1 text-[13px] font-bold text-primary" data-add-from-saved>
          <Plus className="h-4 w-4" /> Add from Saved
        </button>
      )}
      <MoveToAlbumSheet postIds={ids} open={moving} onOpenChange={setMoving} onDone={stopSelecting} />
      {album && <AlbumMenuSheet album={album} open={menu} onOpenChange={setMenu} onDeleted={onBack} />}
      {album && <AddFromSavedSheet album={album} unit={unit} open={adding} onOpenChange={setAdding} />}
    </div>
  );
}

/** Name a new album (with any posts to start it). */
function NameAlbumSheet({ open, onOpenChange, postIds, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; postIds?: string[]; onCreated?: (a: { id: string; name: string }) => void }) {
  const create = useCreateAlbum();
  const [name, setName] = useState("");
  useEffect(() => {
    if (!open) setName("");
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className={SHEET} style={KEYBOARD_SAFE} data-name-album>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
        <form
          className="px-5 pb-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            create.mutate({ name: n, postIds }, { onError: fail, onSuccess: (a) => { onOpenChange(false); onCreated?.(a); } });
          }}
        >
          <SheetTitle className="text-[16px] font-black">New album</SheetTitle>
          <SheetDescription className="mt-0.5 text-[12px] text-muted-foreground">Only you can see it.</SheetDescription>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            maxLength={40}
            placeholder="Form tips, Meal ideas, Programs…"
            enterKeyHint="done"
            className="mt-3 h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"
            aria-label="Album name"
            data-album-name
          />
          <button type="submit" disabled={!name.trim() || create.isPending} className="mt-3 h-11 w-full rounded-xl bg-primary text-[14px] font-bold text-primary-foreground disabled:opacity-50">
            {create.isPending ? "Making it…" : "Create album"}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Put the picked posts in one of your albums, or a new one. */
function MoveToAlbumSheet({ postIds, open, onOpenChange, onDone }: { postIds: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { data } = useSavedOverview(open);
  const albumPosts = useAlbumPosts();
  const [naming, setNaming] = useState(false);
  const albums = data?.albums ?? [];
  const urls = useCoverUrls(albums.flatMap((a) => a.covers.slice(0, 1)));
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" hideCloseButton className={SHEET} data-move-to-album>
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <SheetTitle className="text-[16px] font-black">Add {postIds.length} to…</SheetTitle>
            <button type="button" onClick={() => setNaming(true)} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-bold text-primary active:bg-muted">
              <Plus className="h-4 w-4" /> New album
            </button>
          </div>
          <SheetDescription className="sr-only">Pick an album for the selected posts</SheetDescription>
          <div className="max-h-[50vh] overflow-y-auto pb-1">
            {albums.length === 0 && <p className="px-5 py-4 text-[13px] text-muted-foreground">No albums yet. Make one with New album.</p>}
            {albums.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={albumPosts.isPending}
                onClick={() =>
                  albumPosts.mutate(
                    { albumId: a.id, postIds, add: true },
                    { onError: fail, onSuccess: () => { toast(`Added to ${a.name}`); onOpenChange(false); onDone(); } },
                  )
                }
                className="flex w-full items-center gap-3 px-5 py-2 text-left active:bg-muted"
              >
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">
                  <CoverFace cover={a.covers[0]} url={a.covers[0]?.path ? urls[a.covers[0].path] : null} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{a.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{a.count} {a.count === 1 ? "post" : "posts"}</span>
                </span>
              </button>
            ))}
          </div>
          <SheetClose className="mt-1 h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
        </SheetContent>
      </Sheet>
      <NameAlbumSheet
        open={naming}
        onOpenChange={setNaming}
        postIds={postIds}
        onCreated={(a) => {
          toast(`Added to ${a.name}`);
          onOpenChange(false);
          onDone();
        }}
      />
    </>
  );
}

/** ••• on an album: Rename, Delete (its posts stay in Saved). */
function AlbumMenuSheet({ album, open, onOpenChange, onDeleted }: { album: SavedAlbum; open: boolean; onOpenChange: (o: boolean) => void; onDeleted: () => void }) {
  const rename = useRenameAlbum();
  const del = useDeleteAlbum();
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState(album.name);
  useEffect(() => {
    if (open) {
      setMode("menu");
      setName(album.name);
    }
  }, [open, album.name]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className={SHEET} style={KEYBOARD_SAFE} data-album-options>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
        <SheetTitle className="truncate px-5 pt-3 text-[16px] font-black">{mode === "delete" ? `Delete ${album.name}?` : album.name}</SheetTitle>
        <SheetDescription className="px-5 pb-2 text-[12px] text-muted-foreground">
          {mode === "delete" ? "The album goes. Its posts stay in Saved." : `${album.count} ${album.count === 1 ? "post" : "posts"} · only you can see it`}
        </SheetDescription>
        {mode === "menu" && (
          <div className="border-t border-border/60">
            <button type="button" onClick={() => setMode("rename")} className="flex min-h-[52px] w-full items-center px-5 text-left text-[15px] font-semibold active:bg-muted">Rename album</button>
            <button type="button" onClick={() => setMode("delete")} className="flex min-h-[52px] w-full items-center border-t border-border/60 px-5 text-left text-[15px] font-semibold text-destructive active:bg-muted" data-delete-album>Delete album</button>
            <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
          </div>
        )}
        {mode === "rename" && (
          <form
            className="px-5 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              rename.mutate({ id: album.id, name }, { onError: fail, onSuccess: () => onOpenChange(false) });
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              maxLength={40}
              enterKeyHint="done"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus:border-primary"
              aria-label="Album name"
            />
            <button type="submit" disabled={!name.trim() || rename.isPending} className="mt-3 h-11 w-full rounded-xl bg-primary text-[14px] font-bold text-primary-foreground disabled:opacity-50">
              Save name
            </button>
          </form>
        )}
        {mode === "delete" && (
          <div className="border-t border-border/60">
            <button
              type="button"
              disabled={del.isPending}
              onClick={() => del.mutate(album.id, { onError: fail, onSuccess: () => { toast(`Deleted ${album.name}`); onOpenChange(false); onDeleted(); } })}
              className="h-12 w-full text-[14px] font-bold text-destructive active:bg-muted"
              data-delete-album-confirm
            >
              Delete album
            </button>
            <SheetClose className="h-12 w-full border-t border-border/60 text-[14px] font-semibold active:bg-muted">Cancel</SheetClose>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Pick posts from All saved to put in this album. */
function AddFromSavedSheet({ album, unit, open, onOpenChange }: { album: SavedAlbum; unit: "kg" | "lb"; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useSavedPosts(null, open);
  const inAlbum = useSavedPosts(album.id, open);
  const have = useMemo(() => new Set((inAlbum.data?.pages.flatMap((p) => p.posts) ?? []).map((p) => p.id)), [inAlbum.data]);
  const posts = useMemo(() => (q.data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => !have.has(p.id)), [q.data, have]);
  const { data: urls } = usePostMediaUrls(posts);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const albumPosts = useAlbumPosts();
  useEffect(() => {
    if (!open) setPicked(new Set());
  }, [open]);
  const ids = [...picked];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="flex max-h-[88dvh] flex-col gap-0 rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:mx-auto sm:max-w-[520px]" data-add-from-saved-sheet>
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-3">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[16px] font-black">Add to {album.name}</SheetTitle>
            <SheetDescription className="text-[12px] text-muted-foreground">{ids.length ? `${ids.length} selected` : "Tap the posts to add"}</SheetDescription>
          </div>
          <button
            type="button"
            disabled={!ids.length || albumPosts.isPending}
            onClick={() => albumPosts.mutate({ albumId: album.id, postIds: ids, add: true }, { onError: fail, onSuccess: () => { toast(`Added to ${album.name}`); onOpenChange(false); } })}
            className="h-10 shrink-0 rounded-full bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {q.isLoading ? (
            <div className="py-8 text-center text-[13px] text-muted-foreground">Loading…</div>
          ) : posts.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted-foreground">Everything you've saved is already in here.</div>
          ) : (
            <PostGrid
              posts={posts}
              urls={urls}
              unit={unit}
              edge={false}
              pager={q}
              picked={picked}
              onTap={(p) =>
                setPicked((cur) => {
                  const next = new Set(cur);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Someone's Reposts tab: what they reposted, newest first, each wearing 🔁. */
export function RepostsGrid({ userId, isMe, unit, onOpenPost }: { userId: string; isMe: boolean; unit: "kg" | "lb"; onOpenPost: (p: CommunityPost) => void }) {
  const q = useUserReposts(userId);
  const posts = useMemo(() => q.data?.pages.flatMap((p) => p.posts) ?? [], [q.data]);
  const { data: urls } = usePostMediaUrls(posts);
  if (q.isLoading) return <GridSkeleton rows={2} />;
  if (!posts.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-[13px] text-muted-foreground" data-reposts-empty>
        {isMe ? "Posts you repost show here. Tap 🔁 under a post to put it in front of your followers." : "No reposts yet."}
      </div>
    );
  }
  return (
    <div data-reposts-grid>
      <PostGrid posts={posts} urls={urls} unit={unit} onTap={onOpenPost} mark="repost" pager={q} />
    </div>
  );
}
