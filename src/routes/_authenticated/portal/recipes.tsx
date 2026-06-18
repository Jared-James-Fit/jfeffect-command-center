import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/recipes")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/nutrition-targets", hash: "recipes" });
  },
});
