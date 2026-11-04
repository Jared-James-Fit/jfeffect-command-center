import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// SOPs was only ever a "coming soon" placeholder.
export const Route = createFileRoute("/_authenticated/admin/sops")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/settings", replace: true });
  },
});
