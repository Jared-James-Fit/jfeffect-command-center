import { createFileRoute, redirect } from "@tanstack/react-router";

// JF Effect is free to join now: the old paid membership page goes to the free sign-up.
export const Route = createFileRoute("/membership")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/join", search: location.search as any, replace: true });
  },
  component: () => null,
});
