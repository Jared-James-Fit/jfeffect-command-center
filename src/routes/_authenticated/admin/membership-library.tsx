import { createFileRoute, redirect } from "@tanstack/react-router";

// The membership app's programs are the one program library with its
// Membership app chip picked; this address forwards there.
export const Route = createFileRoute("/_authenticated/admin/membership-library")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs", audience: "membership" } as any, replace: true });
  },
});
