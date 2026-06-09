import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getRecipe, markRecipeSeen } from "@/lib/recipes";
import { RecipeBodyView } from "@/components/recipe-body-view";
import { usePortalUserId } from "@/lib/client-impersonation";

export const Route = createFileRoute("/_authenticated/portal/recipes/$recipeId")({
  component: PortalRecipeDetail,
});

function PortalRecipeDetail() {
  const { recipeId } = Route.useParams();
  const userId = usePortalUserId();
  const { data: recipe, isLoading } = useQuery({
    queryKey: ["portal-recipe", recipeId],
    queryFn: () => getRecipe(recipeId),
  });

  useEffect(() => {
    if (recipe && userId) markRecipeSeen(recipe.id, userId).catch(() => {});
  }, [recipe?.id, userId]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!recipe) return <div className="p-6 text-sm text-muted-foreground">Recipe not found.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/portal/recipes"><ArrowLeft className="mr-1 h-4 w-4" /> All Recipes</Link>
      </Button>
      <Card className="space-y-4 p-5 md:p-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold leading-tight">{recipe.title}</h1>
            <Badge variant="outline" className="text-[10px]">{recipe.category}</Badge>
          </div>
        </div>
        <RecipeBodyView body={recipe.body} videoUrl={recipe.video_url} />
      </Card>
    </div>
  );
}