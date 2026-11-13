import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Membership programs are the one program library with its Membership app chip
// picked (Programming → Programs), not a second library.
export const Route = createFileRoute("/_authenticated/admin/membership/programs")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs", audience: "membership" } as any, replace: true });
  },
});
