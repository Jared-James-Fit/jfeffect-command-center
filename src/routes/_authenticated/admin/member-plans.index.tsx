import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// The membership app's programs are listed from the one program library
// (Programming → Programs → Membership app); a listing is a switch on a program.
export const Route = createFileRoute("/_authenticated/admin/member-plans/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs", audience: "membership" } as any, replace: true });
  },
});
