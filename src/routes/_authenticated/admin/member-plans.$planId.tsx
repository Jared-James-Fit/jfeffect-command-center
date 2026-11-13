import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// A membership listing is edited from its program (the library row's ⋯ →
// Membership app), so every old plan link opens the membership programs.
export const Route = createFileRoute("/_authenticated/admin/member-plans/$planId")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs", audience: "membership" } as any, replace: true });
  },
});
