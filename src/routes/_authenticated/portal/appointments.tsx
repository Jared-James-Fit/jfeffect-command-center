import { createFileRoute, redirect } from "@tanstack/react-router";

// Sessions and calls live on the one Schedule page now. Kept so old links,
// bookmarks and notification taps still land in the right place.
export const Route = createFileRoute("/_authenticated/portal/appointments")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/calendar", replace: true });
  },
});
