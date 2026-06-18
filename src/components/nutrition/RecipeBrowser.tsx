import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { ChefHat, Sparkles, SlidersHorizontal, X } from "lucide-react";
import { listRecipesForViewer, listRecipeUnseen, type Recipe } from "@/lib/recipes";
import { RecipeCard } from "./RecipeCard";

/**
 * Single recipe browser used by both members (/m/nutrition) and coaching
 * clients (/portal/recipes, /portal/nutrition-targets). Same data, same UI.
 */

const VISIBLE_CATEGORIES = ["Recommended", "Breakfast", "Lunch", "Dinner", "Snack", "Drinks", "Meal Prep"] as const;
type Category = (typeof VISIBLE_CATEGORIES)[number] | "All";

// Phase 5 — six advanced filters, hidden behind one Filters button.
const ADVANCED_FILTERS = [
  { value: "high-protein", label: "High Protein" },
  { value: "fat-loss", label: "Fat Loss", tagAliases: ["low-calorie", "fat-loss"] },
  { value: "muscle-gain", label: "Muscle Gain", tagAliases: ["muscle-gain", "higher-calorie"] },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "omnivore", label: "Omnivore" },
  { value: "quick", label: "Quick Meals", tagAliases: ["quick", "quick-meal", "15-min", "20-min"] },
  { value: "performance", label: "Performance", tagAliases: ["performance", "post-workout"] },
  { value: "drinks", label: "Drinks", tagAliases: ["drink", "drinks", "beverage", "smoothie", "shake"] },
] as const;

// Phase 8 — recipe scoring by stored goal text.
const GOAL_TAG_MAP: Record<string, string[]> = {
  "fat loss": ["low-calorie", "high-protein", "fat-loss"],
  maintenance: ["high-protein", "balanced"],
  "muscle gain": ["high-protein", "muscle-gain", "higher-calorie"],
  powerlifting: ["high-protein", "muscle-gain", "higher-calorie", "performance"],
  bodybuilding: ["high-protein", "low-calorie", "muscle-gain"],
  // Legacy member goal phrasings — keep working.
  "lose fat": ["low-calorie", "high-protein", "fat-loss"],
  "get stronger": ["high-protein", "muscle-gain"],
  "athletic performance": ["high-protein", "performance", "post-workout"],
  "general fitness": ["high-protein", "low-calorie"],
  "powerlifting meet": ["high-protein", "muscle-gain", "higher-calorie"],
};

function matchesFilter(recipe: Recipe, filter: string): boolean {
  const tags = (recipe.tags ?? []).map((t) => t.toLowerCase());
  const def = ADVANCED_FILTERS.find((f) => f.value === filter);
  const aliases = (def && "tagAliases" in def ? (def as any).tagAliases : null) ?? [filter];
  return aliases.some((a: string) => tags.includes(a));
}

function scoreRecipe(recipe: Recipe, goals: string[]): number {
  const tags = (recipe.tags ?? []).map((t) => t.toLowerCase());
  let score = 0;
  for (const g of goals) {
    const wanted = GOAL_TAG_MAP[g.toLowerCase()] ?? [];
    for (const w of wanted) if (tags.includes(w)) score += 2;
  }
  return score;
}

export type RecipeBrowserProps = {
  /** Which detail route to deep-link into. */
  viewer: "member" | "client";
  /** Auth user id — used to fetch the "New" badge state. */
  userId?: string;
  /** Free-text goal labels driving Recommended ordering. */
  goals?: string[];
};

export function RecipeBrowser({ viewer, userId, goals = [] }: RecipeBrowserProps) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Category>("Recommended");
  const [filters, setFilters] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ["nutrition-recipes"],
    queryFn: listRecipesForViewer,
  });

  const { data: unseen = new Set<string>() } = useQuery({
    queryKey: ["nutrition-recipes-unseen", userId],
    enabled: !!userId,
    queryFn: () => listRecipeUnseen(userId!),
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filters.length && !filters.every((f) => matchesFilter(r, f))) return false;
      if (term && !r.title.toLowerCase().includes(term) && !(r.tags ?? []).some((t) => t.toLowerCase().includes(term)))
        return false;
      return true;
    });
  }, [recipes, filters, q]);

  const display = useMemo(() => {
    if (active === "Recommended") {
      if (goals.length === 0) return filtered.slice(0, 10);
      const scored = filtered
        .map((r) => ({ r, s: scoreRecipe(r, goals) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r)
        .slice(0, 10);
      return scored.length > 0 ? scored : filtered.slice(0, 10);
    }
    if (active === "All") return filtered;
    return filtered.filter((r) => r.category === active);
  }, [filtered, active, goals]);

  const toggle = (v: string) =>
    setFilters((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const detailPath =
    viewer === "member" ? "/m/nutrition/$recipeId" : "/portal/recipes/$recipeId";

  return (
    <section className="space-y-4">
      {/* Search + Filters trigger */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search recipes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 flex-1"
        />
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="lg" className="h-11 shrink-0">
              <SlidersHorizontal className="mr-1.5 h-4 w-4" />
              Filters
              {filters.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-[10px]">{filters.length}</Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter recipes</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ADVANCED_FILTERS.map((f) => {
                const on = filters.includes(f.value);
                return (
                  <Button
                    key={f.value}
                    variant={on ? "default" : "outline"}
                    size="lg"
                    className="h-12 justify-start"
                    onClick={() => toggle(f.value)}
                  >
                    {f.label}
                  </Button>
                );
              })}
            </div>
            <SheetFooter className="mt-6 flex-row gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setFilters([])}>
                Clear all
              </Button>
              <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
                Show {display.length} recipe{display.length === 1 ? "" : "s"}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Category chips — horizontal scroll on mobile, large tap targets */}
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {VISIBLE_CATEGORIES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={active === c ? "default" : "outline"}
              onClick={() => setActive(c)}
              className="h-10 shrink-0 rounded-full px-4"
            >
              {c === "Recommended" && <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {c}
            </Button>
          ))}
          <Button
            size="sm"
            variant={active === "All" ? "default" : "outline"}
            onClick={() => setActive("All")}
            className="h-10 shrink-0 rounded-full px-4"
          >
            All
          </Button>
        </div>
      </div>

      {/* Active filter pills */}
      {filters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.map((v) => {
            const def = ADVANCED_FILTERS.find((f) => f.value === v);
            return (
              <Badge key={v} variant="secondary" className="gap-1 pr-1 text-[11px]">
                {def?.label ?? v}
                <button
                  type="button"
                  onClick={() => toggle(v)}
                  className="ml-0.5 rounded p-0.5 hover:bg-background/60"
                  aria-label={`Remove ${def?.label ?? v}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading recipes…</Card>
      ) : display.length === 0 ? (
        <Card className="p-12 text-center">
          <ChefHat className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No recipes match your filters. Try clearing them or pick a different category.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {display.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              isNew={unseen.has(r.id)}
              to={{ pathname: detailPath, params: { recipeId: r.id } }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
