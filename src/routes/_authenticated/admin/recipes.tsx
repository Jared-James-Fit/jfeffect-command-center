import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Eye, BookOpen } from "lucide-react";
import { listRecipesAdmin, deleteRecipe, statusTone, RECIPE_ACCESS_LABELS, type Recipe } from "@/lib/recipes";
import { RECIPE_CATEGORIES, recipePreview } from "@/lib/recipe-format";
import { RecipeForm } from "@/components/recipe-form";
import { RecipeFormattingGuide } from "@/components/recipe-formatting-guide";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/recipes")({ component: AdminRecipes });

function AdminRecipes() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [query, setQuery] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [catF, setCatF] = useState<string>("all");

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ["admin-recipes"],
    queryFn: listRecipesAdmin,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (statusF !== "all" && r.status !== statusF) return false;
      if (catF !== "all" && r.category !== catF) return false;
      if (q && !r.title.toLowerCase().includes(q) && !r.tags.join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [recipes, query, statusF, catF]);

  async function onDelete(id: string) {
    if (!confirm("Delete this recipe?")) return;
    try {
      await deleteRecipe(id);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-recipes"] });
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Recipe Library"
        subtitle="Add, format, and share recipes with clients and members."
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }} className="bg-gradient-primary font-bold">
            <Plus className="mr-1 h-4 w-4" /> New Recipe
          </Button>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <RecipeFormattingGuide />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search recipes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:max-w-xs"
          />
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Published">Published</SelectItem>
              <SelectItem value="Archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={catF} onValueChange={setCatF}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {RECIPE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading recipes…</Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No recipes yet. Create your first one.</p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <Card key={r.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-bold">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                      <Badge variant="outline" className={`text-[10px] ${statusTone(r.status)}`}>{r.status}</Badge>
                    </div>
                  </div>
                </div>
                <p className="line-clamp-3 text-xs text-muted-foreground">{recipePreview(r.body, 160) || "—"}</p>
                <div className="text-[11px] text-muted-foreground">
                  Access: <span className="font-medium text-foreground">{RECIPE_ACCESS_LABELS[r.access_scope]}</span>
                  {r.updated_at && <span> · {format(new Date(r.updated_at), "MMM d")}</span>}
                </div>
                <div className="mt-auto flex gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditing(r); setOpen(true); }} className="flex-1">
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/portal/recipes/$recipeId" params={{ recipeId: r.id } as any}>
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(r.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <RecipeForm
        open={open}
        onOpenChange={setOpen}
        initial={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["admin-recipes"] })}
      />
    </>
  );
}