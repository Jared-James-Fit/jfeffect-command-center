import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/portal/check-in")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/check-ins" });
  },
  component: () => null,
});
