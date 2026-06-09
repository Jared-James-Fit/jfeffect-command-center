import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, ChefHat } from "lucide-react";
import { listRecipesForViewer, listRecipeUnseen } from "@/lib/recipes";
import { RECIPE_CATEGORIES, recipePreview } from "@/lib/recipe-format";
import { usePortalUserId } from "@/lib/client-impersonation";

export const Route = createFileRoute("/_authenticated/portal/recipes")({ component: PortalRecipes });

function PortalRecipes() {
  const userId = usePortalUserId();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ["portal-recipes"],
    queryFn: listRecipesForViewer,
  });

  const { data: unseen = new Set<string>() } = useQuery({
    queryKey: ["portal-recipes-unseen", userId],
    enabled: !!userId,
    queryFn: () => listRecipeUnseen(userId!),
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return recipes.filter((r) => {
      if (cat !== "all" && r.category !== cat) return false;
      if (term && !r.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [recipes, q, cat]);

  return (
    <>
      <PageHeader title="Recipes" subtitle="Fast, simple, coach-approved meals." />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs" />
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {RECIPE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <ChefHat className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No recipes yet. Check back soon.</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <Link key={r.id} to="/portal/recipes/$recipeId" params={{ recipeId: r.id } as any}>
                <Card className="group flex h-full flex-col gap-2 p-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bold">{r.title}</div>
                      <Badge variant="outline" className="mt-1 text-[10px]">{r.category}</Badge>
                    </div>
                    {unseen.has(r.id) && (
                      <Badge className="bg-primary text-primary-foreground text-[10px]">New</Badge>
                    )}
                  </div>
                  <p className="line-clamp-3 text-xs text-muted-foreground">{recipePreview(r.body, 160) || "Open to view"}</p>
                  <div className="mt-auto pt-2">
                    <Button variant="outline" size="sm" className="w-full">
                      <BookOpen className="mr-1 h-3.5 w-3.5" /> Open Recipe
                    </Button>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}