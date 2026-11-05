import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Check-ins are sent and answered in the coach chat.
export const Route = createFileRoute("/_authenticated/portal/check-in")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/messages", replace: true });
  },
});
