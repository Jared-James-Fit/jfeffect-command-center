/**
 * Cookbook body, code-split so the recipes and their read only load when the
 * Cookbook is opened. One read of every published recipe (a short curated
 * list), then search, a row of meal types and Cutting / Bulking, all on the
 * phone. A recipe opens right here (the sheet's Back returns to the list
 * where it was), never as a page that leaves Nutrition.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Apple, Boxes, ChefHat, ChevronRight, Coffee, IceCreamCone, Search, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { listCookbookRecipes } from "@/lib/recipes";
import {
  COOKBOOK_GOALS,
  COOKBOOK_GROUPS,
  cookbookEntry,
  filterCookbook,
  type CookbookEntry,
  type CookbookGoal,
  type CookbookGroup,
} from "@/lib/cookbook/view";
import { CookbookRecipeView, RecipeDisclaimer } from "./CookbookRecipe";
import type { CookbookViewer } from "./CookbookSheet";

export const COOKBOOK_QUERY_KEY = ["cookbook-recipes"] as const;

export default function CookbookContent({
  recipeId,
  onOpenRecipe,
}: {
  viewer: CookbookViewer;
  recipeId: string | null;
  onOpenRecipe: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<CookbookGroup>("all");
  const [goal, setGoal] = useState<CookbookGoal>("any");

  const q = useQuery({
    queryKey: COOKBOOK_QUERY_KEY,
    queryFn: listCookbookRecipes,
    staleTime: 5 * 60_000,
  });
  const entries = useMemo(() => (q.data ?? []).map(cookbookEntry), [q.data]);
  const shown = useMemo(() => filterCookbook(entries, { group, goal, search }), [entries, group, goal, search]);
  const open = recipeId ? entries.find((e) => e.id === recipeId) ?? null : null;
  const plain = group === "all" && goal === "any" && !search.trim();

  return (
    <div className="mt-3">
      {recipeId && (
        <div className="pb-6">
          {open ? (
            <CookbookRecipeView entry={open} />
          ) : q.isLoading ? (
            <ListSkeleton />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">This recipe isn't in the cookbook any more.</p>
          )}
        </div>
      )}

      {/* the list stays mounted under an open recipe, so Back finds it as it was */}
      <div className={cn("space-y-3", recipeId && "hidden")}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Search recipes or ingredients"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 pl-9 pr-10"
            inputMode="search"
            aria-label="Search recipes"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <ChipRow label="Meal">
          {COOKBOOK_GROUPS.map((g) => (
            <Chip key={g.value} on={group === g.value} onClick={() => setGroup(g.value)}>
              {g.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Goal">
          {COOKBOOK_GOALS.map((g) => (
            <Chip key={g.value} on={goal === g.value} onClick={() => setGoal(goal === g.value ? "any" : g.value)}>
              {g.label}
            </Chip>
          ))}
          {goal !== "any" && (
            <span className="self-center pl-1 text-xs text-muted-foreground">
              {goal === "cutting" ? "Leanest, most protein first" : "Biggest first"}
            </span>
          )}
        </ChipRow>

        {q.isLoading ? (
          <ListSkeleton />
        ) : q.isError ? (
          <div className="rounded-xl border border-border p-4 text-sm">
            <div className="font-semibold">Couldn't load the cookbook</div>
            <div className="mt-0.5 text-muted-foreground">Check your connection and try again.</div>
            <Button variant="outline" className="mt-3 h-10" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <div>No recipes match.</div>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => {
                setSearch("");
                setGroup("all");
                setGoal("any");
              }}
            >
              Show every recipe
            </Button>
          </div>
        ) : plain ? (
          <Sections entries={shown} onOpen={onOpenRecipe} />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {shown.length} {shown.length === 1 ? "recipe" : "recipes"}
            </p>
            <RecipeList entries={shown} onOpen={onOpenRecipe} />
          </>
        )}

        <RecipeDisclaimer className="mt-4" />
      </div>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition",
        on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

const SECTION_OF: Record<string, { title: string; order: number }> = {
  Breakfast: { title: "Breakfast", order: 0 },
  Lunch: { title: "Meals", order: 1 },
  Dinner: { title: "Meals", order: 1 },
  Snack: { title: "Snacks", order: 2 },
  Custom: { title: "Snacks", order: 2 },
  Dessert: { title: "Sweet", order: 3 },
  "Meal Prep": { title: "Meal prep", order: 4 },
};

function Sections({ entries, onOpen }: { entries: CookbookEntry[]; onOpen: (id: string) => void }) {
  const groups = new Map<string, CookbookEntry[]>();
  for (const e of entries) {
    const title = SECTION_OF[e.category]?.title ?? "More";
    groups.set(title, [...(groups.get(title) ?? []), e]);
  }
  const order = (t: string) => Object.values(SECTION_OF).find((s) => s.title === t)?.order ?? 9;
  return (
    <div className="space-y-5 pt-1">
      {[...groups.entries()]
        .sort((a, b) => order(a[0]) - order(b[0]))
        .map(([title, list]) => (
          <section key={title}>
            <h3 className="mb-1.5 text-sm font-semibold text-muted-foreground">
              {title} <span className="font-normal">· {list.length}</span>
            </h3>
            <RecipeList entries={list} onOpen={onOpen} />
          </section>
        ))}
    </div>
  );
}

const ICON_OF: Record<string, typeof ChefHat> = {
  Breakfast: Coffee,
  Lunch: UtensilsCrossed,
  Dinner: UtensilsCrossed,
  Snack: Apple,
  Custom: Apple,
  Dessert: IceCreamCone,
  "Meal Prep": Boxes,
};

function RecipeList({ entries, onOpen }: { entries: CookbookEntry[]; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {entries.map((e) => {
        const Icon = ICON_OF[e.category] ?? ChefHat;
        const line = [
          e.calories != null ? `${Math.round(e.calories)} kcal` : null,
          e.protein != null ? `${Math.round(e.protein)} g protein` : null,
          e.prepMinutes != null ? `${e.prepMinutes} min` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onOpen(e.id)}
              className="flex min-h-[60px] w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-muted/50 active:bg-muted"
              data-cookbook-row
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-tight">{e.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                  {line}
                  {e.servings > 1 ? ` · ${e.servings} servings` : ""}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading recipes">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[60px] jf-skeleton rounded-xl bg-muted" />
      ))}
    </div>
  );
}
