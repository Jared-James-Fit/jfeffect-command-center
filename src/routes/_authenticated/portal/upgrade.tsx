import { createFileRoute, redirect } from "@tanstack/react-router";

// Upgrading is Manage plan now (Account → Your plan): one place to compare
// every plan and change it, with the double-billing guards. This page sold
// member-facing products through a checkout of its own (none were ever
// listed); old links, pushes and /m/upgrade land on Your plan.
export const Route = createFileRoute("/_authenticated/portal/upgrade")({
  beforeLoad: () => {
    throw redirect({ to: "/portal/plan", replace: true });
  },
});
