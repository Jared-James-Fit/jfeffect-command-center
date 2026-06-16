import { useMemo, useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookOpen, ChefHat, Sparkles, Settings2, ChevronDown, Apple } from "lucide-react";
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

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return recipes.filter((r) => {
      if (!recipeMatchesRestrictions(r, restrictions)) return false;
      if (term && !r.title.toLowerCase().includes(term) && !(r.tags ?? []).some((t) => t.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [recipes, restrictions, q]);

  const recommended = useMemo(() => {
    if (!prefs) return [] as Recipe[];
    const hasPrefs = (prefs.dietary_preferences?.length ?? 0) > 0 || (prefs.goals_tags?.length ?? 0) > 0;
    if (!hasPrefs) return [];
    const scored = visible
      .map((r) => ({ r, s: recommendationScore(r, prefs) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.r);
    return scored;
  }, [visible, prefs]);

  const byCategory = useMemo(() => {
    const groups: Record<string, Recipe[]> = {};
    for (const r of visible) {
      const key = (RECIPE_CATEGORIES as readonly string[]).includes(r.category) ? r.category : "Custom";
      (groups[key] ??= []).push(r);
    }
    return groups;
  }, [visible]);

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

        <Input placeholder="Search recipes or tags…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading recipes…</Card>
        ) : visible.length === 0 ? (
          <Card className="p-12 text-center">
            <ChefHat className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No recipes match your filters. Try clearing search or restrictions.</p>
          </Card>
        ) : (
          <div className="space-y-8">
            {recommended.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-bold">Recommended for you</h2>
                </div>
                <RecipeGrid recipes={recommended} />
              </section>
            )}
            {RECIPE_CATEGORIES.map((cat) => {
              const items = byCategory[cat] ?? [];
              if (items.length === 0) return null;
              return (
                <section key={cat}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-bold">{cat}</h2>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <RecipeGrid recipes={items} />
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
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
