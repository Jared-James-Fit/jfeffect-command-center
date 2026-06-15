import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy URL — permanently redirect to /join
export const Route = createFileRoute("/signup/jf")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/membership", search: location.search as any, replace: true });
  },
  component: () => null,
});