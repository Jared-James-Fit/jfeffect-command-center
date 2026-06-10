import { createFileRoute, Navigate } from "@tanstack/react-router";

// Consolidated into /admin/sales/membership.
export const Route = createFileRoute("/_authenticated/admin/membership/sales-page")({
  component: () => <Navigate to="/admin/sales/membership" replace />,
});