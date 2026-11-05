import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Progress photos and videos live on Progress.
export const Route = createFileRoute("/_authenticated/portal/media")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/progress", replace: true });
  },
});
