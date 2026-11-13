import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// A coach's "My Programs" (my library, shared with me, team library,
// submissions) was linked from nowhere; every coach uses the one program
// library on Programming → Programs.
export const Route = createFileRoute("/_authenticated/coach/programs")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs" } as any, replace: true });
  },
});
