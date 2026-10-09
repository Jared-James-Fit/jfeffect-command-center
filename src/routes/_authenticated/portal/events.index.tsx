import { createFileRoute, redirect } from "@tanstack/react-router";

// Events live on the one Schedule page now. Event detail pages
// (/portal/events/$id) still exist; this keeps old links and pushes working.
export const Route = createFileRoute("/_authenticated/portal/events/")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/calendar", replace: true });
  },
});
