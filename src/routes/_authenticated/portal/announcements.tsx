import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Announcements were never sent (0 ever) and are gone.
export const Route = createFileRoute("/_authenticated/portal/announcements")({
  beforeLoad: () => {
    throw redirect({ to: "/portal", replace: true });
  },
});
