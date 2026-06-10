import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/membership")({
  beforeLoad: () => {
    throw redirect({ to: "/join", replace: true });
  },
  component: () => null,
});