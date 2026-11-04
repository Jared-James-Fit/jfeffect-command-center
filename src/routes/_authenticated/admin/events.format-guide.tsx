import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Went with the Events list (never used).
export const Route = createFileRoute("/_authenticated/admin/events/format-guide")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/calendar", replace: true });
  },
});
