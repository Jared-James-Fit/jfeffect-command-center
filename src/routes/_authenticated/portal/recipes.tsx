import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/recipes")({
  beforeLoad: ({ location }) => {
    // Only redirect the index — keep /portal/recipes/:recipeId working.
    if (location.pathname.replace(/\/$/, "") === "/portal/recipes") {
      throw redirect({ to: "/portal/nutrition-targets", hash: "recipes" });
    }
  },
});
