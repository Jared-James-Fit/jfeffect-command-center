import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Star, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  listGifs, listFavorites, listRecent, toggleFavorite, markRecent,
  GIF_CATEGORIES, type ChatGif,
} from "@/lib/chat-gifs";

export function GifPicker({
  onPick,
  disabled,
}: {
  onPick: (gif: ChatGif) => void;
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | "all">("all");

  const { data: gifs = [] } = useQuery({
    queryKey: ["chat-gifs"],
    queryFn: listGifs,
    enabled: open,
    staleTime: 60_000,
  });

  const { data: favoriteIds = new Set<string>() } = useQuery({
    queryKey: ["chat-gif-favorites", user?.id],
    queryFn: () => listFavorites(user!.id),
    enabled: open && !!user?.id,
    staleTime: 30_000,
  });

  const { data: recentIds = [] } = useQuery({
    queryKey: ["chat-gif-recent", user?.id],
    queryFn: () => listRecent(user!.id),
    enabled: open && !!user?.id,
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

  const onToggleFav = async (g: ChatGif, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id) return;
    const isFav = favoriteIds.has(g.id);
    try {
      await toggleFavorite(user.id, g.id, isFav);
      qc.invalidateQueries({ queryKey: ["chat-gif-favorites", user.id] });
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
          <img
            src={g.thumb_url || g.media_url}
            alt={g.title}
            loading="lazy"
            className="h-full w-full object-cover motion-reduce:[content-visibility:auto]"
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
        <div className="space-y-2 border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GIFs… hype, PR, cardio, excuses"
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
            {GIF_CATEGORIES.map((c) => (
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
            <TabsContent value="browse" className="m-0"><Grid items={filtered} /></TabsContent>
            <TabsContent value="recent" className="m-0"><Grid items={recentGifs} /></TabsContent>
            <TabsContent value="fav" className="m-0"><Grid items={favoriteGifs} /></TabsContent>
          </div>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}