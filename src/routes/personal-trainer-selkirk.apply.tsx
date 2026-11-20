import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired Nov 20 2026 with the in-person page: old links (and their ?from=)
// go to the online coaching application.
export const Route = createFileRoute("/personal-trainer-selkirk/apply")({
  beforeLoad: ({ location }) => {
    throw redirect({ to: "/coaching/apply", search: location.search as any, replace: true });
  },
  component: () => null,
});
