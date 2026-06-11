import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Star, Search, Play, Pause, Volume2 } from "lucide-react";
import { GifThumb } from "@/components/gif-thumb";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  listGifs, listFavorites, listRecent, toggleFavorite, markRecent,
  GIF_CATEGORIES, type ChatGif,
} from "@/lib/chat-gifs";
import {
  listSounds, listFavorites as listSoundFavs, listRecent as listSoundRecent,
  toggleFavorite as toggleSoundFav, markRecent as markSoundRecent,
  SOUND_CATEGORIES, type ChatSound,
} from "@/lib/chat-sounds";
import { playSound, subscribeSound, stopSound } from "@/lib/sound-player";

export function GifPicker({
  onPick,
  onPickSound,
  showSounds = true,
  disabled,
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
  asDialog,
}: {
  onPick: (gif: ChatGif) => void;
  onPickSound?: (sound: ChatSound) => void;
  showSounds?: boolean;
  disabled?: boolean;
  controlledOpen?: boolean;
  onControlledOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
  asDialog?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openInt, setOpenInt] = useState(false);
  const open = controlledOpen ?? openInt;
  const setOpen = (v: boolean) => onControlledOpenChange ? onControlledOpenChange(v) : setOpenInt(v);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | "all">("all");
  const [mode, setMode] = useState<"gifs" | "sounds">("gifs");

  useEffect(() => { if (!open) stopSound(); }, [open]);

  const { data: gifs = [] } = useQuery({
    queryKey: ["chat-gifs"],
    queryFn: listGifs,
    enabled: open && mode === "gifs",
    staleTime: 60_000,
  });

  const { data: favoriteIds = new Set<string>() } = useQuery({
    queryKey: ["chat-gif-favorites", user?.id],
    queryFn: () => listFavorites(user!.id),
    enabled: open && mode === "gifs" && !!user?.id,
    staleTime: 30_000,
  });

  const { data: recentIds = [] } = useQuery({
    queryKey: ["chat-gif-recent", user?.id],
    queryFn: () => listRecent(user!.id),
    enabled: open && mode === "gifs" && !!user?.id,
    staleTime: 30_000,
  });

  const { data: sounds = [] } = useQuery({
    queryKey: ["chat-sounds"],
    queryFn: listSounds,
    enabled: open && mode === "sounds" && showSounds,
    staleTime: 60_000,
  });
  const { data: soundFavIds = new Set<string>() } = useQuery({
    queryKey: ["chat-sound-favorites", user?.id],
    queryFn: () => listSoundFavs(user!.id),
    enabled: open && mode === "sounds" && !!user?.id,
    staleTime: 30_000,
  });
  const { data: soundRecentIds = [] } = useQuery({
    queryKey: ["chat-sound-recent", user?.id],
    queryFn: () => listSoundRecent(user!.id),
    enabled: open && mode === "sounds" && !!user?.id,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gifs.filter((g) => {
      if (category !== "all" && g.category !== category) return false;
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [gifs, query, category]);

  const byId = useMemo(() => new Map(gifs.map((g) => [g.id, g])), [gifs]);
  const recentGifs = recentIds.map((id) => byId.get(id)).filter(Boolean) as ChatGif[];
  const favoriteGifs = gifs.filter((g) => favoriteIds.has(g.id));

  const filteredSounds = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sounds.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [sounds, query, category]);
  const soundById = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const recentSounds = soundRecentIds.map((id) => soundById.get(id)).filter(Boolean) as ChatSound[];
  const favoriteSounds = sounds.filter((s) => soundFavIds.has(s.id));

  const pick = async (g: ChatGif) => {
    onPick(g);
    setOpen(false);
    if (user?.id) {
      try {
        await markRecent(user.id, g.id);
        qc.invalidateQueries({ queryKey: ["chat-gif-recent", user.id] });
      } catch {}
    }
  };

  const pickSound = async (s: ChatSound) => {
    if (!onPickSound) return;
    stopSound();
    onPickSound(s);
    setOpen(false);
    if (user?.id) {
      try {
        await markSoundRecent(user.id, s.id);
        qc.invalidateQueries({ queryKey: ["chat-sound-recent", user.id] });
      } catch {}
    }
  };

  const onToggleFav = async (g: ChatGif, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id) return;
    const isFav = favoriteIds.has(g.id);
    try {
      await toggleFavorite(user.id, g.id, isFav);
      qc.invalidateQueries({ queryKey: ["chat-gif-favorites", user.id] });
    } catch {}
  };

  const onToggleSoundFav = async (s: ChatSound, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id) return;
    const isFav = soundFavIds.has(s.id);
    try {
      await toggleSoundFav(user.id, s.id, isFav);
      qc.invalidateQueries({ queryKey: ["chat-sound-favorites", user.id] });
    } catch {}
  };

  const Grid = ({ items }: { items: ChatGif[] }) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.length === 0 && (
        <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
          Nothing here yet.
        </div>
      )}
      {items.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => pick(g)}
          className="group relative aspect-square overflow-hidden rounded-md border border-border bg-secondary/40 transition hover:border-primary"
          title={g.title}
        >
          <GifThumb
            src={g.thumb_url || g.media_url}
            title={g.title}
            category={g.category}
            className="h-full w-full"
            emojiClassName="text-4xl sm:text-5xl"
          />
          <button
            type="button"
            onClick={(e) => onToggleFav(g, e)}
            className={cn(
              "absolute right-1 top-1 rounded-full bg-background/80 p-1 opacity-0 transition group-hover:opacity-100",
              favoriteIds.has(g.id) && "opacity-100",
            )}
            aria-label={favoriteIds.has(g.id) ? "Unstar" : "Star"}
          >
            <Star className={cn("h-3 w-3", favoriteIds.has(g.id) ? "fill-warning text-warning" : "text-foreground")} />
          </button>
          <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white">
            {g.title}
          </div>
        </button>
      ))}
    </div>
  );

  const SoundList = ({ items }: { items: ChatSound[] }) => (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && (
        <div className="py-8 text-center text-xs text-muted-foreground">Nothing here yet.</div>
      )}
      {items.map((s) => <SoundRow key={s.id} sound={s} />)}
    </div>
  );

  const SoundRow = ({ sound }: { sound: ChatSound }) => {
    const [playing, setPlaying] = useState(false);
    useEffect(() => subscribeSound((st) => setPlaying(st.url === sound.media_url && st.playing)), [sound.media_url]);
    const isFav = soundFavIds.has(sound.id);
    const seconds = sound.duration_ms ? Math.round(sound.duration_ms / 100) / 10 : null;
    return (
      <div
        role="button"
        onClick={() => pickSound(sound)}
        className="group flex items-center gap-2.5 rounded-lg border border-border bg-background/40 p-2 transition hover:border-primary hover:bg-secondary/40"
      >
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
        <button
          type="button"
          onClick={(e) => onToggleSoundFav(sound, e)}
          className="rounded-full p-1.5 hover:bg-secondary"
          aria-label={isFav ? "Unstar" : "Star"}
        >
          <Star className={cn("h-4 w-4", isFav ? "fill-warning text-warning" : "text-muted-foreground")} />
        </button>
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
          disabled={disabled}
          title="GIFs & effects"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[min(92vw,420px)] p-0"
      >
        {showSounds && onPickSound && (
          <div className="flex items-center gap-1 border-b border-border p-1">
            <button
              type="button"
              onClick={() => { setMode("gifs"); setCategory("all"); setQuery(""); }}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium",
                mode === "gifs" ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
              )}
            >
              GIFs
            </button>
            <button
              type="button"
              onClick={() => { setMode("sounds"); setCategory("all"); setQuery(""); }}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium",
                mode === "sounds" ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
              )}
            >
              Sounds
            </button>
          </div>
        )}
        <div className="space-y-2 border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "sounds"
                ? "Search sounds… PR bell, bruh, cardio"
                : "Search GIFs… hype, PR, cardio, excuses"}
              className="h-8 pl-7 text-sm"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCategory("all")}
              className={cn(
                "shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px]",
                category === "all" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary",
              )}
            >
              All
            </button>
            {(mode === "sounds" ? SOUND_CATEGORIES : GIF_CATEGORIES).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px]",
                  category === c ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <Tabs defaultValue="browse" className="w-full">
          <TabsList className="mx-2 mt-2 grid w-[calc(100%-1rem)] grid-cols-3">
            <TabsTrigger value="browse">Browse</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="fav">Favorites</TabsTrigger>
          </TabsList>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {mode === "gifs" ? (
              <>
                <TabsContent value="browse" className="m-0"><Grid items={filtered} /></TabsContent>
                <TabsContent value="recent" className="m-0"><Grid items={recentGifs} /></TabsContent>
                <TabsContent value="fav" className="m-0"><Grid items={favoriteGifs} /></TabsContent>
              </>
            ) : (
              <>
                <TabsContent value="browse" className="m-0"><SoundList items={filteredSounds} /></TabsContent>
                <TabsContent value="recent" className="m-0"><SoundList items={recentSounds} /></TabsContent>
                <TabsContent value="fav" className="m-0"><SoundList items={favoriteSounds} /></TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}