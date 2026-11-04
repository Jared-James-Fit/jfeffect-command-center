import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Stripe Sync was a placeholder (its one button only showed a toast).
export const Route = createFileRoute("/_authenticated/admin/membership/stripe-sync")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/membership", replace: true });
  },
});
