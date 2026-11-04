import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Resources only ever held one setup placeholder and are gone.
export const Route = createFileRoute("/_authenticated/portal/resources/$slug")({
  beforeLoad: () => {
    throw redirect({ to: "/portal", replace: true });
  },
});
