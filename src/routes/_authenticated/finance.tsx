import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The finance login's home lives in the admin app (/admin/finance). This keeps
 * sign-in routing, old links and saved home-screen routes working.
 */
export const Route = createFileRoute("/_authenticated/finance")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/finance" as any, replace: true });
  },
});
