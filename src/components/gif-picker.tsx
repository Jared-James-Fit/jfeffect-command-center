/**
 * The one GIF & sticker picker, used everywhere (chat, group chats, comments
 * and replies, posts, the story editor, notes).
 *
 * GIFs | Stickers (| Sounds in chat): search as you type (debounced, with
 * suggestions), Trending, Recent and Favourites, scrollable categories, a
 * compact animated grid that loads a screen ahead and pages in as you scroll,
 * one tap to pick. Live results come from the provider (KLIPY) through our
 * server; the app's own library fills in when it's down.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, Search, Play, Pause, Volume2, X, Loader2, Clock, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { MediaView } from "@/components/media/media-view";
import { MEDIA_CATEGORIES, pushHistory, suggestFor, type MediaItem, type MediaKind } from "@/lib/media/media";
import { splitSaved, useMediaBrowse, useSavedMedia, useSavedMediaActions } from "@/lib/media/use-media";
import {
  listSounds, listFavorites as listSoundFavs, listRecent as listSoundRecent,
  toggleFavorite as toggleSoundFav, markRecent as markSoundRecent,
  SOUND_CATEGORIES, type ChatSound,
} from "@/lib/chat-sounds";
import { useQuery } from "@tanstack/react-query";
import { playSound, subscribeSound, stopSound } from "@/lib/sound-player";

export type { MediaItem } from "@/lib/media/media";

type Mode = MediaKind | "sounds";
type Shelf = "trending" | "recent" | "favorites" | string; // string = a category label

const HISTORY_KEY = "jf-media-search-history";
const readHistory = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
};
const writeHistory = (h: string[]) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* private mode */ }
};

function useDebounced<T>(v: T, ms: number) {
  const [d, set] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => set(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function GifPicker({
  onPick,
  onPickSound,
  showSounds = true,
  kinds = ["gif", "sticker"],
  disabled,
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
  asDialog,
}: {
  onPick: (item: MediaItem) => void;
  onPickSound?: (sound: ChatSound) => void;
  showSounds?: boolean;
  /** Which tabs to offer (stickers make no sense where only a GIF fits). */
  kinds?: MediaKind[];
  disabled?: boolean;
  controlledOpen?: boolean;
  onControlledOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
  asDialog?: boolean;
}) {
  const [openInt, setOpenInt] = useState(false);
  const open = controlledOpen ?? openInt;
  const setOpen = (v: boolean) => (onControlledOpenChange ? onControlledOpenChange(v) : setOpenInt(v));
  useEffect(() => { if (!open) stopSound(); }, [open]);

  const body = open ? (
    <PickerBody
      kinds={kinds}
      sounds={showSounds && !!onPickSound}
      onPick={(m) => { onPick(m); setOpen(false); }}
      onPickSound={(s) => { onPickSound?.(s); setOpen(false); }}
    />
  ) : null;

  if (asDialog) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85dvh] max-h-[85dvh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:h-[72vh]">
          <DialogHeader className="sr-only">
            <DialogTitle>GIFs and stickers</DialogTitle>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full text-[10px] font-bold tracking-tight"
            disabled={disabled}
            title="GIFs & stickers"
            aria-label="GIFs & stickers"
          >
            <span className="rounded-[5px] border-[1.5px] border-current px-[3px] leading-[14px]" aria-hidden>GIF</span>
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent side="top" align="start" className="flex h-[min(70vh,560px)] w-[min(94vw,420px)] flex-col overflow-hidden p-0" collisionPadding={12}>
        {body}
      </PopoverContent>
    </Popover>
  );
}

function PickerBody({
  kinds, sounds, onPick, onPickSound,
}: {
  kinds: MediaKind[];
  sounds: boolean;
  onPick: (m: MediaItem) => void;
  onPickSound: (s: ChatSound) => void;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>(kinds[0] ?? "gif");
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [shelf, setShelf] = useState<Shelf>("trending");
  const [history, setHistory] = useState<string[]>(() => (typeof window === "undefined" ? [] : readHistory()));
  const q = useDebounced(text.trim(), 250);
  const kind: MediaKind = mode === "sticker" ? "sticker" : "gif";
  const isMedia = mode !== "sounds";
  const category = !q && shelf !== "trending" && shelf !== "recent" && shelf !== "favorites" ? shelf : null;
  const browsing = isMedia && (!!q || shelf === "trending" || !!category);

  const browse = useMediaBrowse(kind, q, category, browsing);
  const saved = useSavedMedia(user?.id, isMedia);
  const { recent, favorites, favoriteRefs } = useMemo(() => splitSaved(saved.data, kind), [saved.data, kind]);
  const actions = useSavedMediaActions(user?.id);
  const scroller = useRef<HTMLDivElement | null>(null);

  const items: MediaItem[] = q || shelf === "trending" || category ? browse.items : shelf === "recent" ? recent : favorites;
  const suggestions = useMemo(() => (focused ? suggestFor(text, history) : []), [focused, text, history]);

  // new list: back to the top
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [mode, q, shelf]);

  const pick = (m: MediaItem) => {
    if (q) {
      const h = pushHistory(history, q);
      setHistory(h);
      writeHistory(h);
    }
    void actions.markUsed(m, q || (category ?? ""));
    onPick(m);
  };

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) browse.loadMore();
  };

  const tabs: { v: Mode; label: string }[] = [
    ...(kinds.includes("gif") ? [{ v: "gif" as const, label: "GIFs" }] : []),
    ...(kinds.includes("sticker") ? [{ v: "sticker" as const, label: "Stickers" }] : []),
    ...(sounds ? [{ v: "sounds" as const, label: "Sounds" }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-popover text-popover-foreground">
      {tabs.length > 1 && (
        <div className="flex shrink-0 gap-1 px-2 pt-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              aria-selected={mode === t.v}
              onClick={() => { setMode(t.v); setText(""); setShelf("trending"); }}
              className={cn(
                "flex-1 rounded-full py-1.5 text-[13px] font-semibold transition-colors",
                mode === t.v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {isMedia ? (
        <>
          <div className="relative shrink-0 px-2 pt-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 80))}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder={kind === "sticker" ? "Search stickers" : "Search GIFs"}
              enterKeyHint="search"
              className="h-10 rounded-full bg-secondary/60 pl-9 pr-9 text-[16px] md:text-sm"
              aria-label={kind === "sticker" ? "Search stickers" : "Search GIFs"}
            />
            {text && (
              <button type="button" onClick={() => setText("")} className="absolute right-4 top-1/2 mt-1 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {suggestions.length > 0 ? (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto px-2 pb-1 pt-2 [scrollbar-width:none]">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setText(s)}
                  className="shrink-0 rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : !q ? (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto px-2 pb-1 pt-2 [scrollbar-width:none]" role="tablist" aria-label="Categories">
              <Chip on={shelf === "trending"} onClick={() => setShelf("trending")}><TrendingUp className="h-3.5 w-3.5" />Trending</Chip>
              <Chip on={shelf === "recent"} onClick={() => setShelf("recent")}><Clock className="h-3.5 w-3.5" />Recent</Chip>
              <Chip on={shelf === "favorites"} onClick={() => setShelf("favorites")}><Star className="h-3.5 w-3.5" />Favourites</Chip>
              {MEDIA_CATEGORIES.map((c) => (
                <Chip key={c.label} on={shelf === c.label} onClick={() => setShelf(c.label)}>{c.label}</Chip>
              ))}
            </div>
          ) : null}

          <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
            <MediaGrid
              items={items}
              kind={kind}
              loading={(q || shelf === "trending" || !!category) ? browse.loading : saved.isLoading}
              favoriteRefs={favoriteRefs}
              onPick={pick}
              onStar={(m) => actions.toggleFavorite(m, !favoriteRefs.has(m.ref))}
              empty={
                shelf === "recent" && !q ? "Nothing sent yet. What you send shows up here."
                  : shelf === "favorites" && !q ? "Tap the star on anything to keep it here."
                  : browse.error ? "Couldn't load. Check your connection."
                  : q ? `Nothing for "${q}". Try another word.` : "Nothing here yet."
              }
            />
            {browse.loadingMore && (
              <div className="grid place-items-center py-3 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>{browse.available ? "Tap to send · star to save" : "Showing the JF Effect library"}</span>
            {browse.available && <span className="font-semibold tracking-wide">Powered by KLIPY</span>}
          </div>
        </>
      ) : (
        <SoundsPanel onPickSound={onPickSound} />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
        on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MediaGrid({
  items, kind, loading, favoriteRefs, onPick, onStar, empty,
}: {
  items: MediaItem[];
  kind: MediaKind;
  loading: boolean;
  favoriteRefs: Set<string>;
  onPick: (m: MediaItem) => void;
  onStar: (m: MediaItem) => void;
  empty: string;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-1.5" aria-label="Loading">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-square jf-skeleton rounded-lg bg-muted" />)}
      </div>
    );
  }
  if (items.length === 0) return <div className="py-10 text-center text-xs text-muted-foreground">{empty}</div>;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((m) => (
        <div
          key={m.ref}
          // offscreen tiles skip layout and paint entirely (cheap windowing)
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" } as React.CSSProperties}
          className={cn("group relative aspect-square overflow-hidden rounded-lg", kind === "gif" ? "bg-muted" : "bg-secondary/30")}
        >
          <button type="button" onClick={() => onPick(m)} className="block h-full w-full active:scale-[0.97] transition-transform" aria-label={m.title} title={m.title}>
            <MediaView kind={m.kind} src={m.url} preview={m.preview} still={m.still} title={m.title} category={m.category} blur={m.blur} fill small className={kind === "sticker" ? "p-1.5" : undefined} />
          </button>
          <button
            type="button"
            onClick={() => onStar(m)}
            className={cn(
              "absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-background/80 shadow-sm transition-opacity",
              favoriteRefs.has(m.ref) ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-70",
            )}
            aria-label={favoriteRefs.has(m.ref) ? "Remove from favourites" : "Add to favourites"}
            aria-pressed={favoriteRefs.has(m.ref)}
          >
            <Star className={cn("h-3.5 w-3.5", favoriteRefs.has(m.ref) ? "fill-warning text-warning" : "text-foreground")} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---- sounds (chat only; unchanged behaviour) ----------------------------- */

function SoundsPanel({ onPickSound }: { onPickSound: (s: ChatSound) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [tab, setTab] = useState<"browse" | "recent" | "fav">("browse");
  const { data: sounds = [] } = useQuery({ queryKey: ["chat-sounds"], queryFn: listSounds, staleTime: 60_000 });
  const { data: favIds = new Set<string>() } = useQuery({
    queryKey: ["chat-sound-favorites", user?.id], queryFn: () => listSoundFavs(user!.id), enabled: !!user?.id, staleTime: 30_000,
  });
  const { data: recentIds = [] } = useQuery({
    queryKey: ["chat-sound-recent", user?.id], queryFn: () => listSoundRecent(user!.id), enabled: !!user?.id, staleTime: 30_000,
  });
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sounds.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      return s.title.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q));
    });
  }, [sounds, query, category]);
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const list = tab === "browse" ? filtered : tab === "recent" ? (recentIds.map((id) => byId.get(id)).filter(Boolean) as ChatSound[]) : sounds.filter((s) => favIds.has(s.id));

  const pick = async (s: ChatSound) => {
    stopSound();
    onPickSound(s);
    if (user?.id) {
      try {
        await markSoundRecent(user.id, s.id);
        qc.invalidateQueries({ queryKey: ["chat-sound-recent", user.id] });
      } catch { /* convenience only */ }
    }
  };
  const star = async (s: ChatSound) => {
    if (!user?.id) return;
    try {
      await toggleSoundFav(user.id, s.id, favIds.has(s.id));
      qc.invalidateQueries({ queryKey: ["chat-sound-favorites", user.id] });
    } catch { /* convenience only */ }
  };

  return (
    <>
      <div className="shrink-0 space-y-2 px-2 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sounds" className="h-10 rounded-full bg-secondary/60 pl-9 text-[16px] md:text-sm" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          <Chip on={tab === "recent"} onClick={() => setTab("recent")}><Clock className="h-3.5 w-3.5" />Recent</Chip>
          <Chip on={tab === "fav"} onClick={() => setTab("fav")}><Star className="h-3.5 w-3.5" />Favourites</Chip>
          <Chip on={tab === "browse" && category === "all"} onClick={() => { setTab("browse"); setCategory("all"); }}>All</Chip>
          {SOUND_CATEGORIES.map((c) => (
            <Chip key={c} on={tab === "browse" && category === c} onClick={() => { setTab("browse"); setCategory(c); }}>{c}</Chip>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {list.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">Nothing here yet.</div>}
        {list.map((s) => <SoundRow key={s.id} sound={s} fav={favIds.has(s.id)} onPick={() => void pick(s)} onStar={() => void star(s)} />)}
      </div>
    </>
  );
}

function SoundRow({ sound, fav, onPick, onStar }: { sound: ChatSound; fav: boolean; onPick: () => void; onStar: () => void }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => subscribeSound((st) => setPlaying(st.url === sound.media_url && st.playing)), [sound.media_url]);
  const seconds = sound.duration_ms ? Math.round(sound.duration_ms / 100) / 10 : null;
  return (
    <div role="button" tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === "Enter") onPick(); }} className="flex items-center gap-2.5 rounded-lg border border-border bg-background/40 p-2 transition hover:border-primary hover:bg-secondary/40">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void playSound(sound.media_url); }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-95"
        aria-label={playing ? "Stop preview" : "Preview"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Volume2 className="h-3 w-3" />{sound.category}
          {seconds != null && <span>· {seconds}s</span>}
        </div>
        <div className="truncate text-sm font-medium leading-tight">{sound.title}</div>
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onStar(); }} className="rounded-full p-1.5 hover:bg-secondary" aria-label={fav ? "Unstar" : "Star"}>
        <Star className={cn("h-4 w-4", fav ? "fill-warning text-warning" : "text-muted-foreground")} />
      </button>
    </div>
  );
}
