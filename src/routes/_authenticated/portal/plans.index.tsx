import { createFileRoute, redirect } from "@tanstack/react-router";

// The Plan Library is the Programs page's JF Effect tab now: one place for
// every program, with where each one came from. Old links, pushes and
// /m/plans land there.
export const Route = createFileRoute("/_authenticated/portal/plans/")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/programs", search: { tab: "jf" }, replace: true });
  },
});
