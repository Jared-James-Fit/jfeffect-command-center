import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// Check-Ins & Forms listed forms that are sent and answered in the coach chat,
// plus "Check-In Responses" nobody had written since Aug 13 2026. A form itself
// still opens at /portal/check-ins/$formId (check-ins_.$formId.tsx).
export const Route = createFileRoute("/_authenticated/portal/check-ins")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/messages", replace: true });
  },
});
