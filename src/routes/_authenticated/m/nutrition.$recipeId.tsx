import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getRecipe, markRecipeSeen } from "@/lib/recipes";
import { RecipeDetailView } from "@/components/nutrition/RecipeDetailView";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/m/nutrition/$recipeId")({
  component: MemberRecipeDetail,
});

function MemberRecipeDetail() {
  const { recipeId } = Route.useParams();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: recipe, isLoading } = useQuery({
    queryKey: ["m-recipe", recipeId],
    queryFn: () => getRecipe(recipeId),
  });

  useEffect(() => {
    if (recipe && userId) markRecipeSeen(recipe.id, userId).catch(() => {});
  }, [recipe?.id, userId]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!recipe)
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/m/nutrition"><ArrowLeft className="mr-1 h-4 w-4" /> Nutrition & Recipes</Link>
        </Button>
        <Card className="p-6 text-center text-sm text-muted-foreground">
          This recipe isn't available. It may have been removed or you don't have access.
        </Card>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/m/nutrition"><ArrowLeft className="mr-1 h-4 w-4" /> Nutrition & Recipes</Link>
      </Button>
      <Card className="space-y-4 p-5 md:p-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold leading-tight">{recipe.title}</h1>
            <Badge variant="outline" className="text-[10px]">{recipe.category}</Badge>
          </div>
          {(recipe.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {recipe.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          )}
        </div>
        <RecipeDetailView recipe={recipe} />
      </Card>
    </div>
  );
}
