import { createFileRoute, Navigate } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/admin/membership/signup-link")({
  component: () => <Navigate to="/admin/membership/sales-page" replace />,
});