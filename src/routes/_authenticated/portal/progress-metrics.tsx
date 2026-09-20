import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/progress-metrics")({
  beforeLoad: () => {
    throw redirect({ to: "/portal" });
  },
  component: () => null,
});
