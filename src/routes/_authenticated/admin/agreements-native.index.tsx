import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Native agreement packages: none was ever sent or signed; the in-app Coaching Agreement replaced them.
export const Route = createFileRoute("/_authenticated/admin/agreements-native/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/coaching-agreements", replace: true });
  },
});
