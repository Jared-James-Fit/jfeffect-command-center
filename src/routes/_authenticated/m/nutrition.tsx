import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookOpen, ChefHat, Sparkles, Settings2, ChevronDown, Apple, SlidersHorizontal, X } from "lucide-react";
import { listRecipesForViewer, type Recipe } from "@/lib/recipes";
import { RECIPE_CATEGORIES, recipePreview } from "@/lib/recipe-format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/m/nutrition")({
  component: MemberNutrition,
});

const DIETARY_OPTIONS = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "omnivore", label: "Omnivore" },
  { value: "keto-friendly", label: "Keto-friendly" },
  { value: "low-carb", label: "Low-carb" },
  { value: "high-protein", label: "High-protein" },
];

const RESTRICTION_OPTIONS = [
  { value: "alcohol", label: "No alcohol", excludeTags: [] as string[], requireTag: "alcohol-free" },
  { value: "vegetarian-only", label: "No meat", excludeTags: ["omnivore"], requireTag: null as string | null },
  { value: "vegan-only", label: "No animal products", excludeTags: ["omnivore", "vegetarian"], requireTag: null },
  { value: "dessert-free", label: "Skip desserts", excludeTags: ["dessert", "sweet", "cheat-meal"], requireTag: null },
];

const GOAL_FILTERS = [
  { value: "high-protein", label: "High protein" },
  { value: "low-calorie", label: "Low calorie" },
  { value: "muscle-gain", label: "Muscle gain" },
  { value: "performance", label: "Performance" },
  { value: "post-workout", label: "Post-workout" },
];

const PREP_FILTERS = [
  { value: "quick", label: "Quick (≤20 min)", tags: ["quick", "quick-meal", "15-min", "20-min"] },
  { value: "meal-prep", label: "Meal prep", tags: ["meal-prep", "batch", "make-ahead"] },
];

const DIFFICULTY_FILTERS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const CATEGORY_CHIPS = ["Recommended", ...RECIPE_CATEGORIES.filter((c) => c !== "Custom"), "All Recipes"] as const;
type CategoryChip = (typeof CATEGORY_CHIPS)[number];

type MemberPrefs = {
  user_id: string;
  id: string;
  goals_tags: string[] | null;
  dietary_preferences: string[];
  food_restrictions: string[];
};

function recipeMatchesRestrictions(r: Recipe, restrictions: string[]): boolean {
  const tags = (r.tags ?? []).map((t) => t.toLowerCase());
  for (const code of restrictions) {
    const opt = RESTRICTION_OPTIONS.find((o) => o.value === code);
    if (!opt) continue;
    if (opt.excludeTags.some((t) => tags.includes(t))) return false;
    if (opt.requireTag && !tags.includes(opt.requireTag)) return false;
  }
  return true;
}

function recipeMatchesFilters(
  r: Recipe,
  filters: { dietary: string[]; goal: string[]; prep: string[]; difficulty: string[] },
): boolean {
  const tags = (r.tags ?? []).map((t) => t.toLowerCase());
  for (const d of filters.dietary) if (!tags.includes(d.toLowerCase())) return false;
  for (const g of filters.goal) if (!tags.includes(g.toLowerCase())) return false;
  for (const p of filters.prep) {
    const opt = PREP_FILTERS.find((o) => o.value === p);
    if (!opt) continue;
    if (!opt.tags.some((t) => tags.includes(t))) return false;
  }
  if (filters.difficulty.length > 0 && !filters.difficulty.some((d) => tags.includes(d))) return false;
  return true;
}

function recommendationScore(r: Recipe, prefs: MemberPrefs | null): number {
  if (!prefs) return 0;
  const tags = (r.tags ?? []).map((t) => t.toLowerCase());
  let score = 0;
  for (const d of prefs.dietary_preferences ?? []) {
    if (tags.includes(d.toLowerCase())) score += 3;
  }
  const goalTagMap: Record<string, string[]> = {
    "lose fat": ["low-calorie", "high-protein"],
    "get stronger": ["high-protein", "muscle-gain"],
    "athletic performance": ["high-protein", "performance", "post-workout"],
    "general fitness": ["high-protein", "low-calorie"],
    "powerlifting meet": ["high-protein", "muscle-gain", "higher-calorie"],
  };
  for (const goal of prefs.goals_tags ?? []) {
    const wanted = goalTagMap[goal.toLowerCase()] ?? [];
    for (const w of wanted) {
      if (tags.includes(w)) score += 2;
    }
  }
  return score;
}

function MemberNutrition() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [showPrefs, setShowPrefs] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryChip>("Recommended");
  const [fDietary, setFDietary] = useState<string[]>([]);
  const [fGoal, setFGoal] = useState<string[]>([]);
  const [fPrep, setFPrep] = useState<string[]>([]);
  const [fDifficulty, setFDifficulty] = useState<string[]>([]);

  const { data: prefs } = useQuery({
    queryKey: ["m-nutrition-prefs"],
    queryFn: async (): Promise<MemberPrefs | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await (supabase as any)
        .from("app_members")
        .select("id, user_id, goals_tags, dietary_preferences, food_restrictions")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ["m-recipes"],
    queryFn: listRecipesForViewer,
  });

  const updatePrefs = useMutation({
    mutationFn: async (input: { dietary_preferences: string[]; food_restrictions: string[] }) => {
      if (!prefs) return;
      const { error } = await (supabase as any)
        .from("app_members")
        .update(input)
        .eq("id", prefs.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferences saved");
      qc.invalidateQueries({ queryKey: ["m-nutrition-prefs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save preferences"),
  });

  const restrictions = prefs?.food_restrictions ?? [];
  const dietary = prefs?.dietary_preferences ?? [];

  const filters = { dietary: fDietary, goal: fGoal, prep: fPrep, difficulty: fDifficulty };
  const activeFilterCount = fDietary.length + fGoal.length + fPrep.length + fDifficulty.length;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return recipes.filter((r) => {
      if (!recipeMatchesRestrictions(r, restrictions)) return false;
      if (!recipeMatchesFilters(r, filters)) return false;
      if (term && !r.title.toLowerCase().includes(term) && !(r.tags ?? []).some((t) => t.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [recipes, restrictions, q, fDietary, fGoal, fPrep, fDifficulty]);

  const recommended = useMemo(() => {
    if (!prefs) return [] as Recipe[];
    const hasPrefs = (prefs.dietary_preferences?.length ?? 0) > 0 || (prefs.goals_tags?.length ?? 0) > 0;
    if (!hasPrefs) return [];
    const scored = visible
      .map((r) => ({ r, s: recommendationScore(r, prefs) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.r);
    return scored;
  }, [visible, prefs]);

  const displayRecipes = useMemo(() => {
    if (activeCategory === "Recommended") return recommended.length > 0 ? recommended : visible;
    if (activeCategory === "All Recipes") return visible;
    return visible.filter((r) =>
      (RECIPE_CATEGORIES as readonly string[]).includes(r.category)
        ? r.category === activeCategory
        : activeCategory === "All Recipes",
    );
  }, [visible, recommended, activeCategory]);

  const clearFilters = () => {
    setFDietary([]); setFGoal([]); setFPrep([]); setFDifficulty([]);
  };

  const toggle = (arr: string[], setter: (v: string[]) => void, v: string) => {
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  return (
    <>
      <PageHeader title="Nutrition & Recipes" subtitle="Fast, simple, coach-approved meals — personalized to you." />
      <div className="space-y-6 p-4 md:p-6">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Apple className="h-5 w-5 text-primary" />
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-semibold">Your nutrition targets</div>
              <div className="text-xs text-muted-foreground">Daily calories, macros, and check-ins.</div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/m/tools">Open nutrition tools</Link>
            </Button>
          </div>
        </Card>

        <Collapsible open={showPrefs} onOpenChange={setShowPrefs}>
          <Card className="p-4">
            <CollapsibleTrigger asChild>
              <button className="flex w-full items-center justify-between text-left">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Settings2 className="h-4 w-4" /> Recipe preferences
                  {(dietary.length + restrictions.length) > 0 && (
                    <Badge variant="secondary" className="text-[10px]">{dietary.length + restrictions.length} set</Badge>
                  )}
                </span>
                <ChevronDown className={`h-4 w-4 transition ${showPrefs ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dietary preferences</div>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_OPTIONS.map((d) => {
                    const active = dietary.includes(d.value);
                    return (
                      <Button
                        key={d.value}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => {
                          const next = active ? dietary.filter((x) => x !== d.value) : [...dietary, d.value];
                          updatePrefs.mutate({ dietary_preferences: next, food_restrictions: restrictions });
                        }}
                      >{d.label}</Button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Food restrictions</div>
                <div className="flex flex-wrap gap-2">
                  {RESTRICTION_OPTIONS.map((d) => {
                    const active = restrictions.includes(d.value);
                    return (
                      <Button
                        key={d.value}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => {
                          const next = active ? restrictions.filter((x) => x !== d.value) : [...restrictions, d.value];
                          updatePrefs.mutate({ dietary_preferences: dietary, food_restrictions: next });
                        }}
                      >{d.label}</Button>
                    );
                  })}
                </div>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search recipes or tags…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md flex-1 min-w-[200px]" />
          <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal className="mr-1 h-4 w-4" /> Filters
            {activeFilterCount > 0 && <Badge variant="secondary" className="ml-2 text-[10px]">{activeFilterCount}</Badge>}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
          )}
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          {CATEGORY_CHIPS.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={activeCategory === c ? "default" : "outline"}
              onClick={() => setActiveCategory(c)}
              className="rounded-full"
            >
              {c === "Recommended" && <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {c}
            </Button>
          ))}
        </div>

        {/* Compact filter panel */}
        {showFilters && (
          <Card className="p-4 space-y-4">
            <FilterRow label="Dietary" options={DIETARY_OPTIONS} value={fDietary} onToggle={(v) => toggle(fDietary, setFDietary, v)} />
            <FilterRow label="Goal" options={GOAL_FILTERS} value={fGoal} onToggle={(v) => toggle(fGoal, setFGoal, v)} />
            <FilterRow label="Prep time" options={PREP_FILTERS} value={fPrep} onToggle={(v) => toggle(fPrep, setFPrep, v)} />
            <FilterRow label="Difficulty" options={DIFFICULTY_FILTERS} value={fDifficulty} onToggle={(v) => toggle(fDifficulty, setFDifficulty, v)} />
          </Card>
        )}

        {/* Active filter pills */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fDietary.map((v) => (
              <FilterPill key={`d-${v}`} label={DIETARY_OPTIONS.find((o) => o.value === v)?.label ?? v} onRemove={() => toggle(fDietary, setFDietary, v)} />
            ))}
            {fGoal.map((v) => (
              <FilterPill key={`g-${v}`} label={GOAL_FILTERS.find((o) => o.value === v)?.label ?? v} onRemove={() => toggle(fGoal, setFGoal, v)} />
            ))}
            {fPrep.map((v) => (
              <FilterPill key={`p-${v}`} label={PREP_FILTERS.find((o) => o.value === v)?.label ?? v} onRemove={() => toggle(fPrep, setFPrep, v)} />
            ))}
            {fDifficulty.map((v) => (
              <FilterPill key={`x-${v}`} label={DIFFICULTY_FILTERS.find((o) => o.value === v)?.label ?? v} onRemove={() => toggle(fDifficulty, setFDifficulty, v)} />
            ))}
          </div>
        )}

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading recipes…</Card>
        ) : displayRecipes.length === 0 ? (
          <Card className="p-12 text-center">
            <ChefHat className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {activeCategory === "Recommended" && recommended.length === 0
                ? "Set your dietary preferences and goals to see personalized picks."
                : "No recipes match your filters. Try clearing them or pick a different category."}
            </p>
          </Card>
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold">
                {activeCategory === "Recommended" && <Sparkles className="h-4 w-4 text-primary" />}
                {activeCategory}
              </h2>
              <span className="text-xs text-muted-foreground">{displayRecipes.length} recipe{displayRecipes.length === 1 ? "" : "s"}</span>
            </div>
            <RecipeGrid recipes={displayRecipes} />
          </section>
        )}
      </div>
    </>
  );
}

function FilterRow({
  label,
  options,
  value,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = value.includes(o.value);
          return (
            <Button
              key={o.value}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => onToggle(o.value)}
              className="rounded-full"
            >
              {o.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1 text-[11px]">
      {label}
      <button onClick={onRemove} className="ml-0.5 rounded p-0.5 hover:bg-background/60" aria-label={`Remove ${label}`}>
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

function RecipeGrid({ recipes }: { recipes: Recipe[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {recipes.map((r) => (
        <Link key={r.id} to="/m/nutrition/$recipeId" params={{ recipeId: r.id }}>
          <Card className="group flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold leading-snug">{r.title}</div>
                <Badge variant="outline" className="mt-1 text-[10px]">{r.category}</Badge>
              </div>
            </div>
            <p className="line-clamp-3 text-xs text-muted-foreground">{recipePreview(r.body, 160) || "Open to view"}</p>
            <div className="mt-auto flex flex-wrap gap-1 pt-2">
              {(r.tags ?? []).slice(0, 3).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2 w-full">
              <BookOpen className="mr-1 h-3.5 w-3.5" /> Open Recipe
            </Button>
          </Card>
        </Link>
      ))}
    </div>
  );
}
