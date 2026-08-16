/**
 * Cookbook body — code-split so the recipe library and its query only load
 * when the client actually opens the Cookbook.
 */

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Clock, Flame, Beef, Loader2, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COOKBOOK_CATEGORIES,
  COOKBOOK_FILTERS,
  COOKBOOK_PAGE_SIZE,
  buildCookbookQuerySpec,
  listCookbookPage,
  type CookbookCategory,
  type Recipe,
} from "@/lib/recipes";
import { getRecipeCardMeta } from "@/lib/recipe-meta";
import type { CookbookViewer } from "./CookbookSheet";

export default function CookbookContent({ viewer }: { viewer: CookbookViewer }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CookbookCategory>("Recommended");
  const [filters, setFilters] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = useInfiniteQuery({
    queryKey: ["cookbook", category, filters, search.trim()],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listCookbookPage(
        buildCookbookQuerySpec({ category, filters, search, page: pageParam as number, pageSize: COOKBOOK_PAGE_SIZE }),
      ),
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
    staleTime: 60_000,
  });

  const rows: Recipe[] = useMemo(
    () => (q.data?.pages ?? []).flatMap((p) => p.rows),
    [q.data],
  );

  const detailPath = viewer === "member" ? "/m/nutrition/$recipeId" : "/portal/recipes/$recipeId";

  const toggle = (v: string) =>
    setFilters((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 flex-1"
        />
        <Button
          variant="outline"
          className="h-11 shrink-0"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Filters
          {filters.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">{filters.length}</Badge>
          )}
        </Button>
      </div>

      {filtersOpen && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/20 p-2 sm:grid-cols-3">
          {COOKBOOK_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filters.includes(f.value) ? "default" : "outline"}
              className="h-10 justify-start text-[12px]"
              onClick={() => toggle(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      )}

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {COOKBOOK_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition",
              c === category
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No recipes match yet.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <CookbookCard key={r.id} recipe={r} to={detailPath} />
          ))}
        </div>
      )}

      {q.hasNextPage && (
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {q.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Load more
        </Button>
      )}
    </div>
  );
}

function CookbookCard({ recipe, to }: { recipe: Recipe; to: string }) {
  const meta = getRecipeCardMeta(recipe);
  return (
    <Link
      to={to as any}
      params={{ recipeId: recipe.id } as any}
      className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`View recipe: ${recipe.title}`}
    >
      <Card className="flex items-center gap-3 overflow-hidden p-3 transition hover:border-primary/40 active:scale-[0.99]">
        {recipe.image_url ? (
          <img
            src={recipe.image_url}
            alt={recipe.title}
            loading="lazy"
            className="h-16 w-16 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
            <ChefHat className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold leading-snug">{recipe.title}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{recipe.category}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
            {meta.calories != null && (
              <span className="inline-flex items-center gap-1"><Flame className="h-3 w-3" />{meta.calories} kcal</span>
            )}
            {meta.protein != null && (
              <span className="inline-flex items-center gap-1"><Beef className="h-3 w-3" />{meta.protein}g</span>
            )}
            {meta.prepMinutes != null && (
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{meta.prepMinutes} min</span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
