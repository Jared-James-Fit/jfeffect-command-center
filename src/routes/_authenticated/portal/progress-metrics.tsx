import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/progress-metrics")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/progress", search: { action: "bodyweight" } });
  },
  component: () => null,
});
