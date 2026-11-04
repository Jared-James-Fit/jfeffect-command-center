import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Broadcasts / announcements were never sent (0 ever) and are gone.
export const Route = createFileRoute("/_authenticated/admin/broadcasts/$broadcastId")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/communication", replace: true });
  },
});
