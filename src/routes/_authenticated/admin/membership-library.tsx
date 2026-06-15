import { createFileRoute, redirect } from "@tanstack/react-router";

// "Membership Library" is the publish/manage surface for member-facing programs.
// The detailed admin UI lives at /admin/member-plans; this route forwards there so
// the new sidebar entry and any external references resolve.
export const Route = createFileRoute("/_authenticated/admin/membership-library")({
  beforeLoad: () => { throw redirect({ to: "/admin/member-plans" }); },
});