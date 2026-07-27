import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/m/my-plans")({
  beforeLoad: () => {
    throw redirect({ to: "/m/workouts" });
  },
});