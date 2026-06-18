import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({
  beforeLoad: () => {
    throw redirect({ to: "/m/nutrition" });
  },
});
