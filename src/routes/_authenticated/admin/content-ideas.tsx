import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Was only ever a "coming soon" placeholder.
export const Route = createFileRoute("/_authenticated/admin/content-ideas")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", replace: true });
  },
});
