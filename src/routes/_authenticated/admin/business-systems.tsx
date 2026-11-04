import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Operations was three links to placeholder pages and is gone.
export const Route = createFileRoute("/_authenticated/admin/business-systems")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/team", replace: true });
  },
});
