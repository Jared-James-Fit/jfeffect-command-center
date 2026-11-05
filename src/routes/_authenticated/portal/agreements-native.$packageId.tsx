import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Native agreement packages: none was ever sent or signed; the Coaching Agreement lives in Account.
export const Route = createFileRoute("/_authenticated/portal/agreements-native/$packageId")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/account", replace: true });
  },
});
