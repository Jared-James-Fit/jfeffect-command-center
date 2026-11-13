import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so old links and bookmarks never 404.
// The review inbox for programs coaches submitted to the team or membership
// library: one admin writes every program, and nothing was ever submitted.
export const Route = createFileRoute("/_authenticated/admin/program-submissions")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/programming", search: { tab: "programs" } as any, replace: true });
  },
});
