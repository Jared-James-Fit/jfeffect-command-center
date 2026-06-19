import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, Beef, Wheat, Droplet, Clock, Users } from "lucide-react";
import { RecipeBodyView } from "@/components/recipe-body-view";
import { getRecipeCardMeta } from "@/lib/recipe-meta";
import { parseRecipeBody } from "@/lib/recipe-format";
import type { Recipe } from "@/lib/recipes";

export function RecipeDetailView({ recipe }: { recipe: Recipe }) {
  const meta = getRecipeCardMeta(recipe);
  const parsed = parseRecipeBody(recipe.body ?? "");
  const hasIngredients = parsed.sections.some(
    (s) => s.kind === "list" && s.label === "Ingredients" && s.items.length > 0,
  );
  const hasInstructions = parsed.sections.some(
    (s) => s.kind === "list" && s.label === "Instructions" && s.items.length > 0,
  );
  const hasAnyMeta =
    meta.calories != null ||
    meta.protein != null ||
    meta.carbs != null ||
    meta.fats != null ||
    meta.prepMinutes != null ||
    meta.servings != null;
  const hasBodyContent = parsed.sections.length > 0 || !!recipe.video_url;
  const hasAnything = hasAnyMeta || hasBodyContent;

  return (
    <div className="space-y-5">
      {hasAnyMeta && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat icon={Users} label="Servings" value={meta.servings} />
          <Stat icon={Clock} label="Prep (min)" value={meta.prepMinutes} />
          <Stat icon={Flame} label="Calories" value={meta.calories} />
          <Stat icon={Beef} label="Protein (g)" value={meta.protein} />
          <Stat icon={Wheat} label="Carbs (g)" value={meta.carbs} />
          <Stat icon={Droplet} label="Fats (g)" value={meta.fats} />
        </div>
      )}

      {(hasIngredients || hasInstructions || hasBodyContent) && (
        <RecipeBodyView body={recipe.body ?? ""} videoUrl={recipe.video_url} />
      )}

      {!hasAnything && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Recipe details aren't available yet. Please check back soon or contact your coach.
        </Card>
      )}

      {hasAnything && !hasIngredients && !hasInstructions && (
        <Card className="p-4 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2">Heads up</Badge>
          Full ingredients and instructions haven't been added to this recipe yet.
        </Card>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border/60 bg-secondary/40 p-2 text-center">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="mt-0.5 text-base font-bold leading-tight">{value ?? "—"}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}