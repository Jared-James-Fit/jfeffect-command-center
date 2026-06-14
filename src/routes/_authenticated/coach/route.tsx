import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Coach workspace layout. Auth is enforced by /_authenticated.
 * Per-action checks are done by RLS.
 */
export const Route = createFileRoute("/_authenticated/coach")({
  component: () => <Outlet />,
});