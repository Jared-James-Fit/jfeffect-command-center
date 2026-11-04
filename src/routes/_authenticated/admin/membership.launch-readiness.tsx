import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// A one-time go-live checklist; membership launched, so it's gone.
export const Route = createFileRoute("/_authenticated/admin/membership/launch-readiness")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/membership", replace: true });
  },
});
