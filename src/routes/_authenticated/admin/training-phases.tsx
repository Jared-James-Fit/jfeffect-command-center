import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Training Phases: 7 phases, all made Jun 9 2026 and never touched again; programs carry the blocks.
export const Route = createFileRoute("/_authenticated/admin/training-phases")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", replace: true });
  },
});
