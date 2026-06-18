import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/m/nutrition/targets-setup")({
  beforeLoad: () => {
    throw redirect({ to: "/m/nutrition" });
  },
});
