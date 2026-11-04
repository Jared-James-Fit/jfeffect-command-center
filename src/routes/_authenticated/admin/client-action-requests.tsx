import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Client action requests were never sent (0 ever) and are gone.
export const Route = createFileRoute("/_authenticated/admin/client-action-requests")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/coaching", replace: true });
  },
});
