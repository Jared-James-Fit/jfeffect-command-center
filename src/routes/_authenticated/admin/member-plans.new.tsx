import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// A membership program starts as a program in the library (New program), then
// goes in the membership app from its ⋯: a plan built here had no workouts a
// member could start.
export const Route = createFileRoute("/_authenticated/admin/member-plans/new")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs", new: 1 } as any, replace: true });
  },
});
