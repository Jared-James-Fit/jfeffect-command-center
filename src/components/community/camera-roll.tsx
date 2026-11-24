import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronDown, Copy, Images, Loader2, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { MAX_SLIDES } from "@/lib/community";
import { feedback } from "@/lib/feedback";
import type { ComposerPickHow } from "@/components/community/composer-pick";
import type { useSlideTray, TrayItem } from "@/components/community/slide-tray";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  RECENTS,
  ROLL_PAGE,
  ROLL_THUMB,
  RollCancelled,
  canSeePhotos,
  loadRollFile,
  nativePhotos,
  rollTap,
  tileClock,
  type PhotoAccess,
  type RollAlbum,
  type RollAsset,
} from "@/lib/native-photos";

/**
 * The New post screen's camera roll, in the iPhone app (native-photos.ts):
 * Instagram's way, the photos right under the preview. The album on the left
 * (Recents, Favorites, Videos, your albums), Select on the right; the camera
 * first, then the newest photos and videos, a page at a time as you scroll.
 *
 * One at a time (Instagram's default) a tap shows that photo instead; with
 * Select on a tap adds it, numbered in post order, a tap on one picked shows
 * it, and a tap on the one showing takes it off. A pick becomes a slide in the
 * tray like any other (uploading as soon as it's in); picks from the camera or
 * Apple's picker sit first, numbered the same. Only what's tapped leaves the
 * phone's library.
 */

const FIRST_ALBUM: RollAlbum = { id: RECENTS, title: "Recents", count: 0 };

/** The last page seen this visit, so the grid paints at once the next time New post opens (memory only). */
let lastSeen: { album: string; assets: RollAsset[]; total: number; access: PhotoAccess } | null =
  null;

export function CameraRoll({
  tray,
  list,
  showing,
  onShow,
  multi,
  onMulti,
  onPick,
  onStage,
  onSeeing,
  head,
}: {
  tray: ReturnType<typeof useSlideTray>;
  list: TrayItem[];
  /** The slide on show in the preview. */
  showing: string | null;
  onShow: (trayId: string) => void;
  multi: boolean;
  onMulti: (on: boolean) => void;
  /** The phone's camera, or Apple's picker. */
  onPick: (how: ComposerPickHow) => void;
  /** A tile tapped and still loading: its thumbnail fills the preview meanwhile (null: done). */
  onStage: (thumb: string | null) => void;
  /** Whether the photos can show (access given), for the preview's words. */
  onSeeing?: (seeing: boolean) => void;
  /** The gallery head's swipe (up for more photos, down for the preview). */
  head: React.HTMLAttributes<HTMLDivElement> & { expanded: boolean };
}) {
  const plugin = useMemo(() => nativePhotos(), []);
  const [access, setAccess] = useState<PhotoAccess | null>(lastSeen?.access ?? null);
  const [album, setAlbum] = useState<RollAlbum>(FIRST_ALBUM);
  const [albums, setAlbums] = useState<RollAlbum[]>([]);
  const [albumSheet, setAlbumSheet] = useState(false);
  const [assets, setAssets] = useState<RollAsset[]>(
    lastSeen?.album === RECENTS ? lastSeen.assets : [],
  );
  const [total, setTotal] = useState(lastSeen?.album === RECENTS ? lastSeen.total : 0);
  const [paging, setPaging] = useState(false);
  // a picked asset → its slide in the tray (null while it loads)
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const gen = useRef(0);
  // New post closed mid-load: nothing that lands afterwards goes in the tray (or starts uploading)
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const staged = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const albumRef = useRef(album.id);
  albumRef.current = album.id;

  const page = useCallback(
    async (albumId: string, offset: number, limit = ROLL_PAGE) => {
      if (!plugin) return null;
      try {
        return await plugin.list({ album: albumId, offset, limit, thumb: ROLL_THUMB });
      } catch {
        return null;
      }
    },
    [plugin],
  );

  /** The album's first page (again: a change in the library keeps as many as were loaded). */
  const reload = useCallback(
    async (albumId: string, keep = ROLL_PAGE) => {
      const res = await page(albumId, 0, Math.min(120, Math.max(ROLL_PAGE, keep)));
      if (!res || albumRef.current !== albumId) return;
      setAssets(res.assets);
      setTotal(res.total);
      if (albumId === RECENTS)
        lastSeen = {
          album: albumId,
          assets: res.assets.slice(0, ROLL_PAGE),
          total: res.total,
          access: "authorized",
        };
    },
    [page],
  );

  const loadAlbums = useCallback(async () => {
    if (!plugin) return;
    try {
      const res = await plugin.albums();
      setAlbums(res.albums ?? []);
    } catch {
      /* the grid still works on Recents */
    }
  }, [plugin]);

  // what access JF Effect has; with it, the newest photos
  useEffect(() => {
    if (!plugin) return;
    let alive = true;
    void plugin
      .status()
      .then(({ status }) => {
        if (!alive) return;
        setAccess(status);
        if (lastSeen) lastSeen.access = status;
        if (canSeePhotos(status)) {
          void reload(RECENTS);
          void loadAlbums();
        } else {
          setAssets([]);
          setTotal(0);
        }
      })
      .catch(() => alive && setAccess("denied"));
    return () => {
      alive = false;
    };
  }, [plugin, reload, loadAlbums]);

  // a photo taken or deleted meanwhile, or "Manage" changing what's allowed: the grid follows
  const loaded = useRef(0);
  loaded.current = assets.length;
  useEffect(() => {
    if (!plugin || !canSeePhotos(access)) return;
    let t = 0;
    let handle: { remove: () => void | Promise<void> } | null = null;
    let alive = true;
    void Promise.resolve(
      plugin.addListener("change", () => {
        window.clearTimeout(t);
        t = window.setTimeout(() => {
          void reload(albumRef.current, loaded.current);
          void loadAlbums();
        }, 400);
      }),
    )
      .then((h) => {
        if (alive) handle = h;
        else void h?.remove();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      window.clearTimeout(t);
      void handle?.remove();
    };
  }, [plugin, access, reload, loadAlbums]);

  // the next page a screen before the end
  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!el || !root || assets.length >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || paging) return;
        const albumId = albumRef.current;
        setPaging(true);
        void page(albumId, assets.length).then((res) => {
          setPaging(false);
          if (!res || albumRef.current !== albumId) return;
          setAssets((a) => (a.length === assets.length ? [...a, ...res.assets] : a));
          setTotal(res.total);
        });
      },
      { root, rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [assets.length, total, paging, page]);

  // a slide gone from the tray (✕ in the preview, the Edit step, the post closed) frees its tile
  useEffect(() => {
    const ids = new Set(list.map((it) => it.id));
    setPicks((p) => {
      let changed = false;
      const next: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(p)) {
        if (v !== null && !ids.has(v)) changed = true;
        else next[k] = v;
      }
      return changed ? next : p;
    });
  }, [list]);

  // the preview keeps the tapped tile's thumbnail until the slide has its own picture
  useEffect(() => {
    const key = staged.current;
    if (!key) return;
    const tid = picks[key];
    if (tid === undefined || (tid && list.find((it) => it.id === tid)?.preview)) {
      staged.current = null;
      onStage(null);
    }
  }, [picks, list, onStage]);

  const trayIds = useMemo(
    () => new Set(Object.values(picks).filter((v): v is string => !!v)),
    [picks],
  );
  // slides that came from the camera or Apple's picker (not a tile here): shown first, numbered the same
  const extras = useMemo(() => list.filter((it) => !trayIds.has(it.id)), [list, trayIds]);
  const order = useMemo(() => new Map(list.map((it, i) => [it.id, i + 1])), [list]);
  const loadingCount = Object.values(picks).filter((v) => v === null).length;
  const showingKey = useMemo(() => {
    for (const [k, v] of Object.entries(picks)) if (v && v === showing) return k;
    return showing;
  }, [picks, showing]);

  const allPickedKeys = () => [...Object.keys(picks), ...extras.map((it) => it.id)];

  const tapAsset = async (a: RollAsset) => {
    const plan = rollTap({
      multi,
      picked: allPickedKeys(),
      showing: showingKey,
      key: a.id,
      max: MAX_SLIDES,
    });
    if (plan.kind === "focus") {
      const tid = picks[a.id];
      if (tid) onShow(tid);
      return;
    }
    if (plan.kind === "remove") {
      const tid = picks[a.id];
      if (tid) tray.remove(tid);
      setPicks((p) => {
        const { [a.id]: _gone, ...rest } = p;
        return rest;
      });
      feedback("tap");
      return;
    }
    if (plan.kind === "full") {
      toast.message(`A post holds ${MAX_SLIDES}`, { description: "Take one off to add another." });
      return;
    }
    feedback("tap");
    const mine = ++gen.current;
    const single = !multi;
    // one at a time: the tiles show the new pick at once; the old slide goes once the new one's in
    const replaceTray = single ? list.map((it) => it.id) : [];
    setPicks((p) => (single ? { [a.id]: null } : { ...p, [a.id]: null }));
    staged.current = a.id;
    onStage(a.thumb ?? null);
    const stale = () => !alive.current || (single && gen.current !== mine);
    try {
      const res = await loadRollFile(a, {
        cancelled: stale,
        onProgress: (p) => setProgress((x) => ({ ...x, [a.id]: p })),
      });
      if (stale()) return;
      if ("tooBig" in res) {
        dropPick(a.id);
        toast.message("This video is too big to open here", {
          description: "Choose it from your library instead.",
          action: { label: "Library", onClick: () => onPick("videos") },
        });
        return;
      }
      for (const id of replaceTray) tray.remove(id);
      await tray.add([res.file], undefined, {
        onAdded: (ids) => {
          if (stale()) {
            for (const id of ids) tray.remove(id);
            return;
          }
          if (!ids[0]) return dropPick(a.id);
          setPicks((p) => (a.id in p ? { ...p, [a.id]: ids[0] } : p));
          onShow(ids[0]);
        },
      });
    } catch (e) {
      if (e instanceof RollCancelled || stale()) return;
      dropPick(a.id);
      toast.error(a.kind === "video" ? "Couldn't open that video" : "Couldn't open that photo", {
        description:
          e instanceof Error && /iCloud|library/.test(e.message)
            ? e.message
            : "Try again, or choose it from your library.",
      });
    } finally {
      setProgress((x) => {
        if (!(a.id in x)) return x;
        const { [a.id]: _done, ...rest } = x;
        return rest;
      });
    }
  };

  const dropPick = (key: string) => {
    setPicks((p) => {
      if (!(key in p)) return p;
      const { [key]: _gone, ...rest } = p;
      return rest;
    });
    if (staged.current === key) {
      staged.current = null;
      onStage(null);
    }
  };

  const tapExtra = (it: TrayItem) => {
    const plan = rollTap({
      multi,
      picked: allPickedKeys(),
      showing: showingKey,
      key: it.id,
      max: MAX_SLIDES,
    });
    if (plan.kind === "remove" || (!multi && it.id === showing)) {
      if (plan.kind === "remove") tray.remove(it.id);
      return;
    }
    onShow(it.id);
  };

  // Select off with several picked: the one showing stays (Instagram keeps one)
  const toggleMulti = () => {
    const on = !multi;
    feedback("tap");
    if (!on && list.length > 1) {
      const keep = showing ?? list[0]?.id ?? null;
      for (const it of list) if (it.id !== keep) tray.remove(it.id);
    }
    onMulti(on);
  };

  const askAccess = async () => {
    if (!plugin) return;
    try {
      const { status } = await plugin.requestAccess();
      setAccess(status);
      if (canSeePhotos(status)) {
        void reload(RECENTS);
        void loadAlbums();
      }
    } catch {
      setAccess("denied");
    }
  };

  const chooseAlbum = (a: RollAlbum) => {
    setAlbumSheet(false);
    if (a.id === album.id) return;
    setAlbum(a);
    albumRef.current = a.id;
    setAssets([]);
    setTotal(0);
    scroller.current?.scrollTo({ top: 0 });
    void reload(a.id);
  };

  const { expanded, ...headProps } = head;
  const seeing = canSeePhotos(access);
  useEffect(() => onSeeing?.(seeing), [seeing, onSeeing]);
  return (
    <>
      <div
        className="touch-none select-none"
        {...headProps}
        data-composer-gallery-head={expanded ? "expanded" : "collapsed"}
        data-camera-roll-head
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/30" aria-hidden />
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-2">
          <span data-composer-source className="min-w-0">
            <button
              type="button"
              disabled={!seeing}
              onClick={() => {
                setAlbumSheet(true);
                void loadAlbums();
              }}
              className="inline-flex min-w-0 max-w-full items-center gap-1 text-[17px] font-semibold active:opacity-60 disabled:opacity-100"
              aria-label={`Album: ${album.title}. Tap to change`}
              data-roll-album
            >
              <span className="truncate">{album.title}</span>
              {seeing && <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>
          </span>
          <span className="flex shrink-0 items-center gap-1.5" data-composer-source>
            {multi && list.length + loadingCount > 0 && (
              <span
                className="text-[13px] font-medium tabular-nums text-white/55"
                aria-live="polite"
              >
                {list.length + loadingCount}/{MAX_SLIDES}
              </span>
            )}
            {seeing && (
              <button
                type="button"
                onClick={toggleMulti}
                aria-pressed={multi}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold active:scale-95",
                  multi ? "bg-white text-black" : "bg-white/10 text-white active:bg-white/20",
                )}
                data-roll-select={multi ? "on" : "off"}
              >
                <Copy className="h-3.5 w-3.5" /> Select
              </button>
            )}
          </span>
        </div>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24"
        data-no-swipe-back
        data-camera-roll={access ?? "loading"}
      >
        {access === "limited" && (
          <div
            className="flex items-center justify-between gap-3 px-4 pb-2 text-[13px] text-white/70"
            data-roll-limited
          >
            <span>You've allowed some of your photos.</span>
            <button
              type="button"
              onClick={() => void plugin?.manageLimited().catch(() => undefined)}
              className="shrink-0 font-semibold text-white active:opacity-60"
            >
              Manage
            </button>
          </div>
        )}
        {access === "notDetermined" && (
          <AccessPanel
            title="Show your photos here"
            body="Pick from your camera roll right in JF Effect. Nothing leaves your phone until you post it."
            primary={{ label: "Allow access", onClick: () => void askAccess(), testId: "allow" }}
            secondary={{ label: "Choose from library instead", onClick: () => onPick("library") }}
            state="ask"
          />
        )}
        {(access === "denied" || access === "restricted") && (
          <AccessPanel
            title="JF Effect can't see your photos"
            body={
              access === "restricted"
                ? "Photos access is restricted on this phone. You can still choose from your library."
                : "Turn on Photos for JF Effect in Settings, or choose from your library."
            }
            primary={
              access === "denied"
                ? {
                    label: "Open Settings",
                    onClick: () => void plugin?.openSettings().catch(() => undefined),
                    testId: "settings",
                    icon: true,
                  }
                : {
                    label: "Choose from library",
                    onClick: () => onPick("library"),
                    testId: "library",
                  }
            }
            secondary={
              access === "denied"
                ? { label: "Choose from library", onClick: () => onPick("library") }
                : null
            }
            state="denied"
          />
        )}
        {access === null && (
          <div className="grid place-items-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-white/50" />
          </div>
        )}
        {seeing && (
          <div className="grid grid-cols-4 gap-[2px]">
            <button
              type="button"
              disabled={multi && list.length >= MAX_SLIDES}
              onClick={() => onPick("camera")}
              className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 bg-zinc-900 text-white/85 active:bg-zinc-800 disabled:opacity-30"
              aria-label="Take a photo or video"
              data-composer-camera-tile
            >
              <Camera className="h-7 w-7" />
              <span className="text-[11px] font-semibold">Camera</span>
            </button>
            {extras.map((it) => (
              <Tile
                key={it.id}
                thumb={it.preview}
                video={it.kind === "video" ? (it.seconds ?? null) : null}
                number={order.get(it.id) ?? null}
                multi={multi}
                on={it.id === showing}
                loading={it.status === "preparing" && !it.preview}
                progress={null}
                label={`${it.kind === "video" ? "Clip" : "Photo"} from the camera`}
                onTap={() => tapExtra(it)}
                extra
              />
            ))}
            {assets.map((a) => {
              const tid = picks[a.id];
              const picked = tid !== undefined;
              return (
                <Tile
                  key={a.id}
                  thumb={a.thumb ?? null}
                  video={a.kind === "video" ? a.duration : null}
                  number={picked ? (tid ? (order.get(tid) ?? null) : null) : null}
                  picked={picked}
                  multi={multi}
                  on={picked && (tid === null ? !multi : tid === showing)}
                  loading={picked && tid === null}
                  progress={progress[a.id] ?? null}
                  label={`${a.kind === "video" ? `Video, ${tileClock(a.duration)}` : "Photo"}${picked ? ", picked" : ""}`}
                  onTap={() => void tapAsset(a)}
                />
              );
            })}
          </div>
        )}
        {seeing && assets.length === 0 && total === 0 && access !== null && (
          <p className="px-6 py-10 text-center text-[14px] text-white/55" data-roll-empty>
            No photos or videos here yet.
          </p>
        )}
        {seeing && assets.length < total && (
          <div ref={sentinel} className="grid place-items-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
          </div>
        )}
      </div>

      <Sheet open={albumSheet} onOpenChange={setAlbumSheet}>
        <SheetContent
          side="bottom"
          swipeToClose
          hideCloseButton
          className="max-h-[80dvh] rounded-t-2xl px-0 pb-[max(env(safe-area-inset-bottom),1rem)]"
          data-roll-albums
        >
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <SheetTitle className="px-5 pb-1 text-[17px]">Albums</SheetTitle>
          <SheetDescription className="sr-only">Pick which photos to show</SheetDescription>
          <div className="max-h-[62dvh] overflow-y-auto">
            {(albums.length ? albums : [FIRST_ALBUM]).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => chooseAlbum(a)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-2.5 text-left active:bg-muted"
                data-roll-album-row={a.id === RECENTS ? "recents" : "album"}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{a.title}</span>
                  {a.count > 0 && (
                    <span className="block text-[13px] text-muted-foreground tabular-nums">
                      {a.count.toLocaleString()}
                    </span>
                  )}
                </span>
                {a.id === album.id && <Check className="h-5 w-5 shrink-0" />}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t px-5 pt-3">
            <button
              type="button"
              onClick={() => {
                setAlbumSheet(false);
                onPick("library");
              }}
              className="flex min-h-11 w-full items-center gap-2 text-[15px] font-medium active:opacity-60"
              data-roll-browse
            >
              <Images className="h-5 w-5" /> Browse with Apple's photo picker
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AccessPanel({
  title,
  body,
  primary,
  secondary,
  state,
}: {
  title: string;
  body: string;
  primary: { label: string; onClick: () => void; testId: string; icon?: boolean };
  secondary: { label: string; onClick: () => void } | null;
  state: "ask" | "denied";
}) {
  return (
    <div
      className="flex flex-col items-center gap-2.5 px-8 pb-4 pt-3 text-center animate-in fade-in-0 duration-300"
      data-roll-access={state}
    >
      <div className="text-[17px] font-semibold">{title}</div>
      <p className="max-w-[300px] text-[13px] leading-snug text-white/60">{body}</p>
      <button
        type="button"
        onClick={primary.onClick}
        className="mt-1 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground active:scale-[0.97]"
        data-roll-access-action={primary.testId}
      >
        {primary.icon && <Settings className="h-4 w-4" />}
        {primary.label}
      </button>
      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          className="text-[14px] font-semibold text-white/80 active:opacity-60"
          data-roll-access-library
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}

/** One tile: the thumbnail, a video's length, and its pick state (a veil one at a time, a number with Select on). */
function Tile({
  thumb,
  video,
  number,
  picked = false,
  multi,
  on,
  loading,
  progress,
  label,
  onTap,
  extra = false,
}: {
  thumb: string | null;
  video: number | null;
  number: number | null;
  picked?: boolean;
  multi: boolean;
  on: boolean;
  loading: boolean;
  progress: number | null;
  label: string;
  onTap: () => void;
  extra?: boolean;
}) {
  const isPicked = picked || extra;
  return (
    <button
      type="button"
      onClick={onTap}
      className="relative aspect-[3/4] select-none overflow-hidden bg-zinc-900 [-webkit-touch-callout:none] active:opacity-80"
      aria-label={label}
      aria-pressed={isPicked}
      data-roll-tile={extra ? "extra" : isPicked ? "picked" : "idle"}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          draggable={false}
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="block h-full w-full bg-zinc-800" />
      )}
      {on && !multi && <span className="pointer-events-none absolute inset-0 bg-white/40" />}
      {on && multi && <span className="pointer-events-none absolute inset-0 bg-white/25" />}
      {video != null && (
        <span className="pointer-events-none absolute bottom-1 right-1.5 text-[12px] font-semibold tabular-nums drop-shadow">
          {tileClock(video)}
        </span>
      )}
      {multi && (
        <span
          className={cn(
            "pointer-events-none absolute right-1.5 top-1.5 grid h-[22px] min-w-[22px] place-items-center rounded-full border-[1.5px] border-white px-1 text-[12px] font-bold text-white shadow",
            isPicked ? "bg-primary animate-in zoom-in-50 duration-200" : "bg-black/20",
          )}
        >
          {isPicked
            ? (number ?? (loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null))
            : null}
        </span>
      )}
      {loading && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30">
          {progress != null && progress > 0 ? (
            <Ring p={progress} />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          )}
        </span>
      )}
      {extra && multi && on && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/65">
          <X className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}

function Ring({ p }: { p: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
      <circle cx="14" cy="14" r={r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, p))}
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}
