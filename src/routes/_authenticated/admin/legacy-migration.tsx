import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// The Trainerize move is done (no legacy billing records left) and nothing linked here.
export const Route = createFileRoute("/_authenticated/admin/legacy-migration")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/clients", replace: true });
  },
});
