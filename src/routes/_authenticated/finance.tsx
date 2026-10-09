import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The finance login now works in the admin app, view-only, with the books
 * under Sales. This keeps old links and saved home-screen routes working.
 */
export const Route = createFileRoute("/_authenticated/finance")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/sales", search: { tab: "taxes" } as any, replace: true });
  },
});
