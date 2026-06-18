import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/m/nutrition/targets-manage")({
  beforeLoad: () => {
    throw redirect({ to: "/m/nutrition" });
  },
});
