import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links never 404. The old
// recipe list (a second copy of the Nutrition page with a recipe browser under
// it, and a member's meal plan panel even for coaching clients) is the
// Cookbook in Nutrition now; `?cookbook=1` opens it.
export const Route = createFileRoute("/_authenticated/portal/recipes/")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/nutrition-targets", search: { cookbook: "1" } as never, replace: true });
  },
});
