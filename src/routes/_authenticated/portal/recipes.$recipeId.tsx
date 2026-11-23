import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { getRecipe, markRecipeSeen } from "@/lib/recipes";
import { cookbookEntry } from "@/lib/cookbook/view";
import { CookbookRecipeView } from "@/components/nutrition/CookbookRecipe";
import { usePortalUserId } from "@/lib/client-impersonation";

/**
 * A recipe on its own page: where a recipe link sent in a chat (or the
 * coach's preview from Admin → Recipes) lands. The same recipe view as the
 * Cookbook; Back goes back, or to the Cookbook when there's nowhere to go.
 */
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

  return (
    <>
      <PageHeader title="Recipe" backTo="/portal/nutrition-targets" />
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-4 md:px-6">
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading">
            <div className="h-7 w-2/3 jf-skeleton rounded bg-muted" />
            <div className="h-16 jf-skeleton rounded-xl bg-muted" />
            <div className="h-40 jf-skeleton rounded-xl bg-muted" />
          </div>
        ) : !recipe ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            This recipe isn't in the cookbook any more. Open Nutrition → Open Cookbook for the current recipes.
          </p>
        ) : (
          <>
            {/* the coach's preview of a draft or archived recipe (clients only ever read published ones) */}
            {recipe.status !== "Published" && (
              <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{recipe.status}: not in the Cookbook.</p>
            )}
            <CookbookRecipeView entry={cookbookEntry(recipe)} canLog={false} />
          </>
        )}
      </div>
    </>
  );
}
