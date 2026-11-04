import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Events were never used (three blank test events): the list and its tab are gone. A single event still opens at /admin/events/$id.
export const Route = createFileRoute("/_authenticated/admin/events/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/calendar", replace: true });
  },
});
