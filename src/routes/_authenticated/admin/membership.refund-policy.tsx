import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Was a second menu entry for the same settings card as Checkout settings.
export const Route = createFileRoute("/_authenticated/admin/membership/refund-policy")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/membership/checkout-settings", replace: true });
  },
});
